param(
  [string]$ApiBase = "https://backend-0lcs.onrender.com",
  [string]$EmailPattern = "qa.*@example.com",
  [string]$RoutingBase = "https://router.project-osrm.org",
  [double]$DepotLat = -32.819094,
  [double]$DepotLon = -68.804286,
  [int]$TickMs = 5000,
  [double]$StepMeters = 60.0,
  [int]$DeliveryPauseMs = 60000,
  [int]$PausePingMs = 5000
)

$ErrorActionPreference = "Stop"
$script:RouteCache = @{}

function Get-Token {
  param([string]$ApiBase, [string]$Username, [string]$Password)
  $body = "username=$Username&password=$Password"
  $res = Invoke-RestMethod -Uri "$ApiBase/admin/auth/token" -Method POST -Body $body -ContentType "application/x-www-form-urlencoded" -TimeoutSec 30
  return [string]$res.access_token
}

function Get-Headers {
  param([string]$Token)
  return @{ Authorization = "Bearer $Token" }
}

function Get-Coord {
  param($Value)
  if ($null -eq $Value) { return $null }
  try { return [double]$Value } catch { return $null }
}

function Get-DepartmentCenter {
  param([string]$Department)
  $map = @{
    "Capital" = @{ lat = -32.8895; lon = -68.8458 }
    "Godoy Cruz" = @{ lat = -32.9253; lon = -68.8446 }
    "Guaymallen" = @{ lat = -32.8898; lon = -68.7282 }
    "Las Heras" = @{ lat = -32.8527; lon = -68.8285 }
    "Maipu" = @{ lat = -32.9774; lon = -68.7804 }
    "Lujan de Cuyo" = @{ lat = -33.0395; lon = -68.8803 }
    "San Martin" = @{ lat = -33.0810; lon = -68.4686 }
    "Rivadavia" = @{ lat = -33.1907; lon = -68.4609 }
    "Tunuyan" = @{ lat = -33.5769; lon = -69.0155 }
    "San Rafael" = @{ lat = -34.6177; lon = -68.3301 }
  }
  if ($map.ContainsKey($Department)) { return $map[$Department] }
  return @{ lat = -32.8895; lon = -68.8458 }
}

function Get-DeterministicPoint {
  param(
    [string]$Seed,
    [string]$Department
  )
  $center = Get-DepartmentCenter -Department $Department
  $seedBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$Seed)
  $md5 = [System.Security.Cryptography.MD5]::Create()
  try {
    $hash = $md5.ComputeHash($seedBytes)
  }
  finally {
    $md5.Dispose()
  }
  $latOffset = (($hash[0] * 256 + $hash[1]) % 2400) / 100000.0 - 0.012
  $lonOffset = (($hash[2] * 256 + $hash[3]) % 2400) / 100000.0 - 0.012
  return @{
    lat = [math]::Round(([double]$center.lat + $latOffset), 6)
    lon = [math]::Round(([double]$center.lon + $lonOffset), 6)
  }
}

function Get-OrderCoords {
  param($Order)
  $pairs = @(
    @($Order.delivery_lat, $Order.delivery_lon),
    @($Order.user_lat, $Order.user_lon),
    @($Order.user_latitude, $Order.user_longitude)
  )
  try {
    $tp = $Order._token_preview
    if ($tp) {
      $pairs += ,@($tp.lat, $tp.lon)
      $pairs += ,@($tp.latitude, $tp.longitude)
      if ($tp.address) {
        $pairs += ,@($tp.address.lat, $tp.address.lon)
        $pairs += ,@($tp.address.latitude, $tp.address.longitude)
      }
    }
  } catch {}

  foreach ($pair in $pairs) {
    $lat = Get-Coord $pair[0]
    $lon = Get-Coord $pair[1]
    if ($null -ne $lat -and $null -ne $lon) {
      return @{ lat = $lat; lon = $lon }
    }
  }

  $seed = "{0}|{1}|{2}|{3}|{4}" -f ([string]$Order.user_department), ([string]$Order.user_barrio), ([string]$Order.user_calle), ([string]$Order.user_numeracion), ([string]$Order.id)
  return Get-DeterministicPoint -Seed $seed -Department ([string]$Order.user_department)
}

function Get-DistanceMeters {
  param(
    [double]$Lat1,
    [double]$Lon1,
    [double]$Lat2,
    [double]$Lon2
  )
  $R = 6371000.0
  $dLat = (($Lat2 - $Lat1) * [math]::PI / 180.0)
  $dLon = (($Lon2 - $Lon1) * [math]::PI / 180.0)
  $a = [math]::Sin($dLat / 2.0) * [math]::Sin($dLat / 2.0) +
       [math]::Cos($Lat1 * [math]::PI / 180.0) * [math]::Cos($Lat2 * [math]::PI / 180.0) *
       [math]::Sin($dLon / 2.0) * [math]::Sin($dLon / 2.0)
  $c = 2.0 * [math]::Atan2([math]::Sqrt($a), [math]::Sqrt(1.0 - $a))
  return $R * $c
}

function Get-Bearing {
  param(
    [double]$Lat1,
    [double]$Lon1,
    [double]$Lat2,
    [double]$Lon2
  )
  $phi1 = $Lat1 * [math]::PI / 180.0
  $phi2 = $Lat2 * [math]::PI / 180.0
  $lambda = ($Lon2 - $Lon1) * [math]::PI / 180.0
  $y = [math]::Sin($lambda) * [math]::Cos($phi2)
  $x = [math]::Cos($phi1) * [math]::Sin($phi2) - [math]::Sin($phi1) * [math]::Cos($phi2) * [math]::Cos($lambda)
  $brng = [math]::Atan2($y, $x) * 180.0 / [math]::PI
  if ($brng -lt 0) { $brng += 360.0 }
  return [math]::Round($brng, 2)
}

function Step-Towards {
  param(
    [double]$FromLat,
    [double]$FromLon,
    [double]$ToLat,
    [double]$ToLon,
    [double]$MaxMeters
  )
  $distance = Get-DistanceMeters -Lat1 $FromLat -Lon1 $FromLon -Lat2 $ToLat -Lon2 $ToLon
  if ($distance -le $MaxMeters) {
    return @{
      lat = [math]::Round($ToLat, 6)
      lon = [math]::Round($ToLon, 6)
      done = $true
      distance = $distance
    }
  }
  $ratio = $MaxMeters / $distance
  return @{
    lat = [math]::Round($FromLat + (($ToLat - $FromLat) * $ratio), 6)
    lon = [math]::Round($FromLon + (($ToLon - $FromLon) * $ratio), 6)
    done = $false
    distance = $distance
  }
}

function Build-StraightLegPoints {
  param(
    [double]$FromLat,
    [double]$FromLon,
    [double]$ToLat,
    [double]$ToLon,
    [double]$MaxMeters
  )
  $out = New-Object System.Collections.Generic.List[object]
  $currentLat = [double]$FromLat
  $currentLon = [double]$FromLon
  $guard = 0
  while ($guard -lt 5000) {
    $guard++
    $step = Step-Towards -FromLat $currentLat -FromLon $currentLon -ToLat $ToLat -ToLon $ToLon -MaxMeters $MaxMeters
    [void]$out.Add([PSCustomObject]@{
      lat = [double]$step.lat
      lon = [double]$step.lon
    })
    $currentLat = [double]$step.lat
    $currentLon = [double]$step.lon
    if ($step.done) { break }
  }
  return $out
}

function Expand-RouteGeometryPoints {
  param(
    [array]$Path,
    [double]$MaxMeters
  )
  $out = New-Object System.Collections.Generic.List[object]
  if (-not $Path -or $Path.Count -lt 2) { return $out }
  for ($i = 1; $i -lt $Path.Count; $i++) {
    $start = $Path[$i - 1]
    $end = $Path[$i]
    $startLat = [double]$start.lat
    $startLon = [double]$start.lon
    $endLat = [double]$end.lat
    $endLon = [double]$end.lon
    $segmentDistance = Get-DistanceMeters -Lat1 $startLat -Lon1 $startLon -Lat2 $endLat -Lon2 $endLon
    if ($segmentDistance -le 0) { continue }
    $segments = [math]::Max(1, [int][math]::Ceiling($segmentDistance / [math]::Max(1.0, $MaxMeters)))
    for ($stepIndex = 1; $stepIndex -le $segments; $stepIndex++) {
      $t = $stepIndex / [double]$segments
      [void]$out.Add([PSCustomObject]@{
        lat = [math]::Round($startLat + (($endLat - $startLat) * $t), 6)
        lon = [math]::Round($startLon + (($endLon - $startLon) * $t), 6)
      })
    }
  }
  return $out
}

function Get-RoadLegPoints {
  param(
    [string]$RoutingBase,
    [double]$FromLat,
    [double]$FromLon,
    [double]$ToLat,
    [double]$ToLon,
    [double]$MaxMeters
  )
  $cacheKey = "{0}|{1}|{2}|{3}|{4}" -f `
    [math]::Round($FromLat, 5), `
    [math]::Round($FromLon, 5), `
    [math]::Round($ToLat, 5), `
    [math]::Round($ToLon, 5), `
    [math]::Round($MaxMeters, 1)
  if ($script:RouteCache.ContainsKey($cacheKey)) {
    return $script:RouteCache[$cacheKey]
  }

  $fallback = Build-StraightLegPoints -FromLat $FromLat -FromLon $FromLon -ToLat $ToLat -ToLon $ToLon -MaxMeters $MaxMeters
  try {
    $url = "{0}/route/v1/driving/{1},{2};{3},{4}?overview=full&geometries=geojson&steps=false" -f `
      $RoutingBase.TrimEnd('/'), `
      ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0}", $FromLon)), `
      ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0}", $FromLat)), `
      ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0}", $ToLon)), `
      ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0}", $ToLat))
    $resp = Invoke-RestMethod -Uri $url -Method GET -TimeoutSec 30
    if ($resp -and [string]$resp.code -eq 'Ok' -and $resp.routes -and $resp.routes[0] -and $resp.routes[0].geometry -and $resp.routes[0].geometry.coordinates) {
      $path = New-Object System.Collections.Generic.List[object]
      foreach ($coord in @($resp.routes[0].geometry.coordinates)) {
        if ($coord.Count -lt 2) { continue }
        [void]$path.Add([PSCustomObject]@{
          lat = [double]$coord[1]
          lon = [double]$coord[0]
        })
      }
      $expanded = Expand-RouteGeometryPoints -Path $path -MaxMeters $MaxMeters
      if ($expanded.Count -gt 0) {
        $script:RouteCache[$cacheKey] = $expanded
        return $expanded
      }
    }
  } catch {
    Write-Warning ("No se pudo obtener ruta vial OSRM: {0}" -f $_.Exception.Message)
  }
  $script:RouteCache[$cacheKey] = $fallback
  return $fallback
}

function Send-Location {
  param(
    [string]$ApiBase,
    [hashtable]$Headers,
    [double]$Lat,
    [double]$Lon,
    [double]$Speed,
    [double]$Heading
  )
  $payload = @{
    lat = $Lat
    lon = $Lon
    accuracy = 8
    speed = $Speed
    heading = $Heading
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  }
  Invoke-RestMethod -Uri "$ApiBase/admin/driver-location" -Method POST -Headers $Headers -ContentType "application/json" -Body ($payload | ConvertTo-Json -Depth 5) -TimeoutSec 30 | Out-Null
}

function Hold-Position {
  param(
    [string]$ApiBase,
    [hashtable]$Headers,
    [double]$Lat,
    [double]$Lon,
    [double]$Heading = 0.0,
    [int]$HoldMs = 60000,
    [int]$PingMs = 5000
  )
  if ($HoldMs -le 0) { return }
  $elapsed = 0
  while ($elapsed -lt $HoldMs) {
    try {
      Send-Location -ApiBase $ApiBase -Headers $Headers -Lat $Lat -Lon $Lon -Speed 0 -Heading $Heading
    } catch {}
    $sleepMs = [math]::Min($PingMs, ($HoldMs - $elapsed))
    if ($sleepMs -gt 0) {
      Start-Sleep -Milliseconds $sleepMs
      $elapsed += $sleepMs
    } else {
      break
    }
  }
}

function Mark-Delivered {
  param([string]$ApiBase, [hashtable]$Headers, [string]$OrderId)
  $body = @{ status = "entregado" } | ConvertTo-Json
  Invoke-RestMethod -Uri "$ApiBase/orders/$OrderId/status" -Method PATCH -Headers $Headers -ContentType "application/json" -Body $body -TimeoutSec 30 | Out-Null
}

function Get-AllQaOrders {
  param([string]$ApiBase, [string]$EmailPattern)
  $orders = Invoke-RestMethod -Uri "$ApiBase/orders?source=web&limit=500" -Method GET -TimeoutSec 40
  return @($orders | Where-Object { [string]$_.user_email -like $EmailPattern })
}

function Get-DriverRemainingOrders {
  param([string]$ApiBase, [hashtable]$Headers, [string]$EmailPattern)
  $list = Invoke-RestMethod -Uri "$ApiBase/admin/orders?status=preparado,enviado&auto=0&limit=500" -Headers $Headers -TimeoutSec 40
  $orders = @($list | Where-Object { [string]$_.user_email -like $EmailPattern })
  return @($orders | Sort-Object -Property @{ Expression = { if ($_.route_order) { [int]$_.route_order } else { 999999 } } }, @{ Expression = { [int]$_.id } })
}

$drivers = @(
  @{ username = "beto"; password = "12345" },
  @{ username = "chula"; password = "12345" },
  @{ username = "lechuga"; password = "12345" },
  @{ username = "caicedo"; password = "12345" }
)

$states = New-Object System.Collections.Generic.List[object]

foreach ($driver in $drivers) {
  $username = [string]$driver.username
  $uname = $username.ToLowerInvariant()
  $token = Get-Token -ApiBase $ApiBase -Username $username -Password ([string]$driver.password)
  $headers = Get-Headers -Token $token
  $remaining = Get-DriverRemainingOrders -ApiBase $ApiBase -Headers $headers -EmailPattern $EmailPattern
  $startLat = $DepotLat
  $startLon = $DepotLon

  $queue = New-Object System.Collections.Generic.List[object]
  foreach ($order in $remaining) {
    $coords = Get-OrderCoords -Order $order
    [void]$queue.Add([PSCustomObject]@{
      id = [string]$order.id
      route_order = if ($order.route_order) { [int]$order.route_order } else { 0 }
      status = [string]$order.status
      lat = [double]$coords.lat
      lon = [double]$coords.lon
      user_email = [string]$order.user_email
      department = [string]$order.user_department
    })
  }

  [void]$states.Add([PSCustomObject]@{
    Username = $username
    Headers = $headers
    CurrentLat = [double]$startLat
    CurrentLon = [double]$startLon
    Queue = $queue
    SentInitial = $false
    DeliveredNow = 0
    InitialRemaining = $queue.Count
    LastHeading = 0.0
    LegPoints = $null
    LegIndex = 0
    LegOrderId = ''
  })
}

Write-Host "=== Estado inicial ==="
$states | ForEach-Object { Write-Host ("{0}: pendientes {1}" -f $_.Username, $_.InitialRemaining) }

$cycle = 0
while (@($states | Where-Object { $_.Queue.Count -gt 0 }).Count -gt 0) {
  $cycle++
  foreach ($state in $states) {
    if ($state.Queue.Count -le 0) { continue }

    if (-not $state.SentInitial) {
      try {
        Send-Location -ApiBase $ApiBase -Headers $state.Headers -Lat $state.CurrentLat -Lon $state.CurrentLon -Speed 0 -Heading 0
      } catch {}
      $state.SentInitial = $true
      continue
    }

    $order = $state.Queue[0]
    if (($state.LegOrderId -ne [string]$order.id) -or -not $state.LegPoints -or $state.LegIndex -ge $state.LegPoints.Count) {
      $state.LegPoints = Get-RoadLegPoints -RoutingBase $RoutingBase -FromLat ([double]$state.CurrentLat) -FromLon ([double]$state.CurrentLon) -ToLat ([double]$order.lat) -ToLon ([double]$order.lon) -MaxMeters $StepMeters
      $state.LegIndex = 0
      $state.LegOrderId = [string]$order.id
    }
    if (-not $state.LegPoints -or $state.LegPoints.Count -eq 0) {
      $state.LegPoints = Build-StraightLegPoints -FromLat ([double]$state.CurrentLat) -FromLon ([double]$state.CurrentLon) -ToLat ([double]$order.lat) -ToLon ([double]$order.lon) -MaxMeters $StepMeters
      $state.LegIndex = 0
    }

    $nextPoint = $state.LegPoints[$state.LegIndex]
    $heading = Get-Bearing -Lat1 $state.CurrentLat -Lon1 $state.CurrentLon -Lat2 ([double]$nextPoint.lat) -Lon2 ([double]$nextPoint.lon)
    $stepDistance = Get-DistanceMeters -Lat1 $state.CurrentLat -Lon1 $state.CurrentLon -Lat2 ([double]$nextPoint.lat) -Lon2 ([double]$nextPoint.lon)
    $speedMps = [math]::Round($stepDistance / [math]::Max(1.0, ($TickMs / 1000.0)), 2)

    try {
      Send-Location -ApiBase $ApiBase -Headers $state.Headers -Lat ([double]$nextPoint.lat) -Lon ([double]$nextPoint.lon) -Speed $speedMps -Heading $heading
    } catch {}

    $state.CurrentLat = [double]$nextPoint.lat
    $state.CurrentLon = [double]$nextPoint.lon
    $state.LastHeading = [double]$heading
    $state.LegIndex += 1

    if ($state.LegIndex -ge $state.LegPoints.Count) {
      try {
        Hold-Position -ApiBase $ApiBase -Headers $state.Headers -Lat $state.CurrentLat -Lon $state.CurrentLon -Heading ([double]$state.LastHeading) -HoldMs $DeliveryPauseMs -PingMs $PausePingMs
        Mark-Delivered -ApiBase $ApiBase -Headers $state.Headers -OrderId ([string]$order.id)
        $state.DeliveredNow++
        [void]$state.Queue.RemoveAt(0)
        $state.LegPoints = $null
        $state.LegIndex = 0
        $state.LegOrderId = ''
        Write-Host ("{0}: entregado #{1} | restantes {2}" -f $state.Username, $order.id, $state.Queue.Count)
      }
      catch {
        Write-Warning ("{0}: no se pudo marcar entregado #{1}" -f $state.Username, $order.id)
      }
    }
  }

  if (($cycle % 15) -eq 0) {
    $progress = $states | ForEach-Object { "{0}:{1}" -f $_.Username, $_.Queue.Count }
    Write-Host ("Tick {0} | {1}" -f $cycle, ($progress -join " | "))
  }

  Start-Sleep -Milliseconds $TickMs
}

Write-Host ""
Write-Host "=== Cerrando tracking ==="
foreach ($state in $states) {
  try {
    Invoke-RestMethod -Uri "$ApiBase/admin/driver-location/offline" -Method POST -Headers $state.Headers -TimeoutSec 20 | Out-Null
  } catch {}
}

Write-Host ""
Write-Host "=== Verificación final ==="
$summary = New-Object System.Collections.Generic.List[object]
foreach ($state in $states) {
  $remaining = Get-DriverRemainingOrders -ApiBase $ApiBase -Headers $state.Headers -EmailPattern $EmailPattern
  [void]$summary.Add([PSCustomObject]@{
    Driver = $state.Username
    StartedWith = $state.InitialRemaining
    DeliveredNow = $state.DeliveredNow
    Remaining = $remaining.Count
  })
}
$summary | Format-Table -AutoSize
