param(
  [string]$ApiBase = "https://backend-0lcs.onrender.com",
  [string]$EmailPattern = "qa.mendoza.*@example.com",
  [double]$DepotLat = -32.819094,
  [double]$DepotLon = -68.804286,
  [int]$PointsPerLeg = 4,
  [int]$DelayMs = 120
)

$ErrorActionPreference = "Stop"

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
  try {
    return [double]$Value
  }
  catch {
    return $null
  }
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
  if ($map.ContainsKey($Department)) {
    return $map[$Department]
  }
  return @{ lat = -32.8895; lon = -68.8458 }
}

function Get-DeterministicPoint {
  param(
    [string]$Seed,
    [string]$Department
  )
  $center = Get-DepartmentCenter -Department $Department
  $seedBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$Seed)
  $hash = [System.Security.Cryptography.MD5]::Create().ComputeHash($seedBytes)
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
  }
  catch {}
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

function Send-Location {
  param(
    [string]$ApiBase,
    [hashtable]$Headers,
    [double]$Lat,
    [double]$Lon,
    [double]$Speed = 11.0,
    [double]$Heading = 0.0
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

function Interpolate-Points {
  param(
    [double]$FromLat,
    [double]$FromLon,
    [double]$ToLat,
    [double]$ToLon,
    [int]$Segments = 4
  )
  $pts = @()
  if ($Segments -lt 1) { $Segments = 1 }
  for ($i = 1; $i -le $Segments; $i++) {
    $t = $i / [double]$Segments
    $pts += @{
      lat = [math]::Round($FromLat + (($ToLat - $FromLat) * $t), 6)
      lon = [math]::Round($FromLon + (($ToLon - $FromLon) * $t), 6)
    }
  }
  return $pts
}

function Mark-Delivered {
  param([string]$ApiBase, [hashtable]$Headers, [string]$OrderId)
  $body = @{ status = "entregado" } | ConvertTo-Json
  Invoke-RestMethod -Uri "$ApiBase/orders/$OrderId/status" -Method PATCH -Headers $Headers -ContentType "application/json" -Body $body -TimeoutSec 30
}

function Get-AssignedOrders {
  param([string]$ApiBase, [hashtable]$Headers, [string]$EmailPattern)
  $list = Invoke-RestMethod -Uri "$ApiBase/admin/orders?status=preparado,enviado&auto=0&limit=500" -Headers $Headers -TimeoutSec 40
  $orders = @($list | Where-Object { [string]$_.user_email -like $EmailPattern })
  return @($orders | Sort-Object -Property @{ Expression = { if ($_.route_order) { [int]$_.route_order } else { 999999 } } }, @{ Expression = { [int]$_.id } })
}

$drivers = @(
  @{ username = "beto"; password = "12345" },
  @{ username = "chula"; password = "12345" },
  @{ username = "lechuga"; password = "12345" }
)

$summary = New-Object System.Collections.Generic.List[object]

foreach ($driver in $drivers) {
  $username = [string]$driver.username
  Write-Host ""
  Write-Host "=== Simulando $username ==="
  $token = Get-Token -ApiBase $ApiBase -Username $username -Password ([string]$driver.password)
  $headers = Get-Headers -Token $token

  $orders = Get-AssignedOrders -ApiBase $ApiBase -Headers $headers -EmailPattern $EmailPattern
  Write-Host ("Pedidos QA asignados: {0}" -f $orders.Count)

  if ($orders.Count -eq 0) {
    [void]$summary.Add([PSCustomObject]@{ Driver = $username; Delivered = 0; MissingCoords = 0; StartCount = 0; EndCount = 0 })
    continue
  }

  Send-Location -ApiBase $ApiBase -Headers $headers -Lat $DepotLat -Lon $DepotLon -Speed 0 -Heading 0
  Start-Sleep -Milliseconds $DelayMs

  $currentLat = $DepotLat
  $currentLon = $DepotLon
  $delivered = 0
  $missingCoords = 0

  foreach ($order in $orders) {
    $coords = Get-OrderCoords -Order $order
    if ($null -eq $coords) {
      $missingCoords++
      Write-Warning ("Pedido #{0} sin coordenadas, se omite." -f $order.id)
      continue
    }

    $points = Interpolate-Points -FromLat $currentLat -FromLon $currentLon -ToLat $coords.lat -ToLon $coords.lon -Segments $PointsPerLeg
    foreach ($pt in $points) {
      Send-Location -ApiBase $ApiBase -Headers $headers -Lat ([double]$pt.lat) -Lon ([double]$pt.lon) -Speed 10.5 -Heading 0
      Start-Sleep -Milliseconds $DelayMs
    }

    Mark-Delivered -ApiBase $ApiBase -Headers $headers -OrderId ([string]$order.id) | Out-Null
    $delivered++
    $currentLat = [double]$coords.lat
    $currentLon = [double]$coords.lon

    if (($delivered % 5) -eq 0 -or $delivered -eq $orders.Count) {
      Write-Host ("{0}: entregados {1}/{2}" -f $username, $delivered, $orders.Count)
    }
    Start-Sleep -Milliseconds $DelayMs
  }

  try {
    Invoke-RestMethod -Uri "$ApiBase/admin/driver-location/offline" -Method POST -Headers $headers -TimeoutSec 20 | Out-Null
  }
  catch {}

  $remaining = Get-AssignedOrders -ApiBase $ApiBase -Headers $headers -EmailPattern $EmailPattern
  [void]$summary.Add([PSCustomObject]@{
    Driver = $username
    Delivered = $delivered
    MissingCoords = $missingCoords
    StartCount = $orders.Count
    EndCount = $remaining.Count
  })
}

Write-Host ""
Write-Host "=== Resumen ==="
$summary | Format-Table -AutoSize
