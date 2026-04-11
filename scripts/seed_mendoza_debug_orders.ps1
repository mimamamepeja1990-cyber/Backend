param(
  [int]$Total = 1000,
  [string]$ApiBase = "https://backend-0lcs.onrender.com",
  [int]$Workers = 32,
  [string]$EmailPrefix = "qa.debug1k",
  [int]$ProductPoolSize = 12,
  [int]$TimeoutSec = 60
)

$ErrorActionPreference = "Stop"

function Get-RandomOffset {
  param(
    [double]$Base,
    [int]$Min = -1800,
    [int]$Max = 1800
  )

  return [math]::Round($Base + ((Get-Random -Minimum $Min -Maximum $Max) / 100000.0), 6)
}

function Get-MendozaZones {
  return @(
    @{
      Department = "Capital"
      Postal = "5500"
      Center = @{ Lat = -32.8895; Lon = -68.8458 }
      Neighborhoods = @("Centro", "Quinta Seccion", "Bombal", "Sexta Seccion")
      Streets = @("Av San Martin", "Aristides Villanueva", "Belgrano", "Pedro Molina", "Sarmiento", "9 de Julio")
    },
    @{
      Department = "Godoy Cruz"
      Postal = "5501"
      Center = @{ Lat = -32.9253; Lon = -68.8446 }
      Neighborhoods = @("Villa Hipodromo", "Bombal Sur", "Benegas", "Trapiche")
      Streets = @("San Martin Sur", "Perito Moreno", "Lavalle", "Cervantes", "Azcuenaga", "Paso de los Andes")
    },
    @{
      Department = "Las Heras"
      Postal = "5539"
      Center = @{ Lat = -32.8527; Lon = -68.8285 }
      Neighborhoods = @("Centro", "El Challao", "Panquehua", "Cementista")
      Streets = @("San Martin", "Independencia", "Roca", "Boulogne Sur Mer", "Olascoaga", "Almirante Brown")
    },
    @{
      Department = "Maipu"
      Postal = "5515"
      Center = @{ Lat = -32.9774; Lon = -68.7804 }
      Neighborhoods = @("Centro", "Russell", "Gutierrez", "Coquimbito")
      Streets = @("Ozamis", "Maza", "J J Paso", "Sarmiento", "Urquiza", "Pescara")
    }
  )
}

function New-MendozaAddress {
  param(
    [int]$Index,
    [string]$Prefix
  )

  $zones = Get-MendozaZones
  $firstNames = @("Lucia", "Mateo", "Valentina", "Tomas", "Malena", "Joaquin", "Mora", "Agustin", "Julieta", "Franco", "Camila", "Santino")
  $lastNames = @("Lopez", "Gimenez", "Sosa", "Rodriguez", "Pereyra", "Diaz", "Luna", "Garcia", "Sanchez", "Morales", "Fernandez", "Vega")

  $zone = Get-Random -InputObject $zones
  $street = Get-Random -InputObject $zone.Streets
  $neighborhood = Get-Random -InputObject $zone.Neighborhoods
  $number = Get-Random -Minimum 40 -Maximum 3999
  $lat = Get-RandomOffset -Base $zone.Center.Lat
  $lon = Get-RandomOffset -Base $zone.Center.Lon
  $name = "{0} {1}" -f (Get-Random -InputObject $firstNames), (Get-Random -InputObject $lastNames)
  $email = "{0}.{1:0000}@example.com" -f $Prefix, $Index

  return @{
    user_full_name = $name
    user_email = $email
    user_barrio = $neighborhood
    user_calle = $street
    user_numeracion = [string]$number
    user_postal_code = $zone.Postal
    user_department = $zone.Department
    user_address = "{0} {1}, {2}, {3}, Mendoza" -f $street, $number, $neighborhood, $zone.Department
    delivery_lat = $lat
    delivery_lon = $lon
  }
}

$ApiBase = $ApiBase.TrimEnd("/")
$ordersEndpoint = "$ApiBase/debug/orders"
$productsEndpoint = "$ApiBase/products"

Write-Host "API: $ApiBase"
Write-Host "Endpoint sin mail: $ordersEndpoint"
Write-Host "Total pedidos a crear: $Total"
Write-Host "Workers: $Workers"
Write-Host "Prefijo QA: $EmailPrefix"

$products = Invoke-RestMethod -Uri $productsEndpoint -Method GET -TimeoutSec $TimeoutSec
if (-not $products) {
  throw "No se pudieron obtener productos desde /products"
}

$productPool = $products |
  Where-Object { $_.active -eq $true -and [string]($_.sale_unit) -ne "kg" -and [double]($_.stock) -gt 0 } |
  Sort-Object -Property @{ Expression = { [double]($_.stock) } } -Descending |
  Select-Object -First $ProductPoolSize

if (-not $productPool -or $productPool.Count -eq 0) {
  throw "No encontre productos unitarios activos con stock para la carga."
}

Write-Host "Pool de productos:"
$productPool | Select-Object id, name, price, stock | Format-Table -AutoSize

$workerCount = [Math]::Max(1, [Math]::Min($Workers, $Total))
$jobs = @()

for ($worker = 0; $worker -lt $workerCount; $worker++) {
  $start = $worker + 1
  $indices = for ($idx = $start; $idx -le $Total; $idx += $workerCount) { $idx }
  if (-not $indices) {
    continue
  }

  $jobs += Start-Job -ScriptBlock {
    param(
      [string]$JobApiBase,
      [string]$JobEmailPrefix,
      [int[]]$JobIndices,
      [object[]]$JobProductPool,
      [int]$JobTimeoutSec
    )

    $ErrorActionPreference = "Stop"

    function Get-RandomOffset {
      param(
        [double]$Base,
        [int]$Min = -1800,
        [int]$Max = 1800
      )

      return [math]::Round($Base + ((Get-Random -Minimum $Min -Maximum $Max) / 100000.0), 6)
    }

    function Get-MendozaZones {
      return @(
        @{
          Department = "Capital"
          Postal = "5500"
          Center = @{ Lat = -32.8895; Lon = -68.8458 }
          Neighborhoods = @("Centro", "Quinta Seccion", "Bombal", "Sexta Seccion")
          Streets = @("Av San Martin", "Aristides Villanueva", "Belgrano", "Pedro Molina", "Sarmiento", "9 de Julio")
        },
        @{
          Department = "Godoy Cruz"
          Postal = "5501"
          Center = @{ Lat = -32.9253; Lon = -68.8446 }
          Neighborhoods = @("Villa Hipodromo", "Bombal Sur", "Benegas", "Trapiche")
          Streets = @("San Martin Sur", "Perito Moreno", "Lavalle", "Cervantes", "Azcuenaga", "Paso de los Andes")
        },
        @{
          Department = "Las Heras"
          Postal = "5539"
          Center = @{ Lat = -32.8527; Lon = -68.8285 }
          Neighborhoods = @("Centro", "El Challao", "Panquehua", "Cementista")
          Streets = @("San Martin", "Independencia", "Roca", "Boulogne Sur Mer", "Olascoaga", "Almirante Brown")
        },
        @{
          Department = "Maipu"
          Postal = "5515"
          Center = @{ Lat = -32.9774; Lon = -68.7804 }
          Neighborhoods = @("Centro", "Russell", "Gutierrez", "Coquimbito")
          Streets = @("Ozamis", "Maza", "J J Paso", "Sarmiento", "Urquiza", "Pescara")
        }
      )
    }

    function New-MendozaAddress {
      param(
        [int]$Index,
        [string]$Prefix
      )

      $zones = Get-MendozaZones
      $firstNames = @("Lucia", "Mateo", "Valentina", "Tomas", "Malena", "Joaquin", "Mora", "Agustin", "Julieta", "Franco", "Camila", "Santino")
      $lastNames = @("Lopez", "Gimenez", "Sosa", "Rodriguez", "Pereyra", "Diaz", "Luna", "Garcia", "Sanchez", "Morales", "Fernandez", "Vega")

      $zone = Get-Random -InputObject $zones
      $street = Get-Random -InputObject $zone.Streets
      $neighborhood = Get-Random -InputObject $zone.Neighborhoods
      $number = Get-Random -Minimum 40 -Maximum 3999
      $lat = Get-RandomOffset -Base $zone.Center.Lat
      $lon = Get-RandomOffset -Base $zone.Center.Lon
      $name = "{0} {1}" -f (Get-Random -InputObject $firstNames), (Get-Random -InputObject $lastNames)
      $email = "{0}.{1:0000}@example.com" -f $Prefix, $Index

      return @{
        user_full_name = $name
        user_email = $email
        user_barrio = $neighborhood
        user_calle = $street
        user_numeracion = [string]$number
        user_postal_code = $zone.Postal
        user_department = $zone.Department
        user_address = "{0} {1}, {2}, {3}, Mendoza" -f $street, $number, $neighborhood, $zone.Department
        delivery_lat = $lat
        delivery_lon = $lon
      }
    }

    $ok = 0
    $fail = 0
    $createdIds = New-Object System.Collections.Generic.List[string]
    $errors = New-Object System.Collections.Generic.List[string]
    $zoneCounts = @{
      Capital = 0
      "Godoy Cruz" = 0
      "Las Heras" = 0
      Maipu = 0
    }

    foreach ($index in $JobIndices) {
      $address = New-MendozaAddress -Index $index -Prefix $JobEmailPrefix
      $product = Get-Random -InputObject $JobProductPool
      $payload = @{
        items = @(
          @{
            id = $product.id
            qty = 1
            meta = @{
              name = $product.name
              price = [double]$product.price
            }
          }
        )
        total = [double]$product.price
        source = "web"
        customer_type = "mayorista"
        user_full_name = $address.user_full_name
        user_email = $address.user_email
        user_barrio = $address.user_barrio
        user_calle = $address.user_calle
        user_numeracion = $address.user_numeracion
        user_postal_code = $address.user_postal_code
        user_department = $address.user_department
        user_address = $address.user_address
        delivery_lat = [double]$address.delivery_lat
        delivery_lon = [double]$address.delivery_lon
      }

      try {
        $response = Invoke-RestMethod -Uri "$JobApiBase/debug/orders" -Method POST -ContentType "application/json" -Body ($payload | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec $JobTimeoutSec
        $ok++
        if ($response -and $response.id) {
          [void]$createdIds.Add([string]$response.id)
        }
        if ($zoneCounts.ContainsKey($address.user_department)) {
          $zoneCounts[$address.user_department]++
        }
      }
      catch {
        $fail++
        $message = $_.Exception.Message
        if ([string]::IsNullOrWhiteSpace($message)) {
          $message = "error desconocido"
        }
        [void]$errors.Add(("pedido {0}: {1}" -f $index, $message))
      }
    }

    [pscustomobject]@{
      ok = $ok
      fail = $fail
      created_ids = @($createdIds)
      errors = @($errors)
      zone_counts = $zoneCounts
    }
  } -ArgumentList $ApiBase, $EmailPrefix, $indices, $productPool, $TimeoutSec
}

$startedAt = Get-Date
Write-Host ("Jobs lanzados: {0} | inicio={1}" -f $jobs.Count, $startedAt.ToString("yyyy-MM-dd HH:mm:ss"))
Wait-Job -Job $jobs | Out-Null

$results = Receive-Job -Job $jobs
Remove-Job -Job $jobs -Force | Out-Null

$okTotal = 0
$failTotal = 0
$allIds = New-Object System.Collections.Generic.List[string]
$allErrors = New-Object System.Collections.Generic.List[string]
$finalZones = @{
  Capital = 0
  "Godoy Cruz" = 0
  "Las Heras" = 0
  Maipu = 0
}

foreach ($result in $results) {
  $okTotal += [int]($result.ok)
  $failTotal += [int]($result.fail)

  foreach ($id in ($result.created_ids | Where-Object { $_ })) {
    [void]$allIds.Add([string]$id)
  }
  foreach ($error in ($result.errors | Where-Object { $_ })) {
    [void]$allErrors.Add([string]$error)
  }
  foreach ($zoneKey in @($finalZones.Keys)) {
    $finalZones[$zoneKey] += [int]($result.zone_counts[$zoneKey])
  }
}

$duration = (Get-Date) - $startedAt
$summary = [pscustomobject]@{
  prefix = $EmailPrefix
  total_requested = $Total
  ok = $okTotal
  fail = $failTotal
  duration_seconds = [math]::Round($duration.TotalSeconds, 2)
  first_ids = @($allIds | Select-Object -First 20)
  zone_counts = $finalZones
  sample_errors = @($allErrors | Select-Object -First 10)
}

$summary | ConvertTo-Json -Depth 6
