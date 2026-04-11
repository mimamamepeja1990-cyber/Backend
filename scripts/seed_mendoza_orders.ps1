param(
  [int]$Total = 200,
  [string]$ApiBase = "https://backend-0lcs.onrender.com",
  [int]$DelayMs = 80
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

function New-MendozaAddress {
  param([int]$Index)

  $zones = @(
    @{
      Department = "Capital"
      Postal = "5500"
      Center = @{ Lat = -32.8895; Lon = -68.8458 }
      Neighborhoods = @("Centro", "Quinta Seccion", "Bombal", "Sexta Seccion")
      Streets = @("Av San Martin", "Aristides Villanueva", "Belgrano", "Pedro Molina", "Sarmiento")
    },
    @{
      Department = "Godoy Cruz"
      Postal = "5501"
      Center = @{ Lat = -32.9253; Lon = -68.8446 }
      Neighborhoods = @("Villa Hipodromo", "Bombal Sur", "Benegas", "Trapiche")
      Streets = @("San Martin Sur", "Perito Moreno", "Lavalle", "Cervantes", "Azcuenaga")
    },
    @{
      Department = "Guaymallen"
      Postal = "5519"
      Center = @{ Lat = -32.8898; Lon = -68.7282 }
      Neighborhoods = @("Dorrego", "San Jose", "Villa Nueva", "Bermejo")
      Streets = @("Bandera de los Andes", "Mathus Hoyos", "Roca", "Mitre", "Urquiza")
    },
    @{
      Department = "Las Heras"
      Postal = "5539"
      Center = @{ Lat = -32.8527; Lon = -68.8285 }
      Neighborhoods = @("Centro", "El Challao", "Panquehua", "Cementista")
      Streets = @("San Martin", "Independencia", "Roca", "Boulogne Sur Mer", "Olascoaga")
    },
    @{
      Department = "Maipu"
      Postal = "5515"
      Center = @{ Lat = -32.9774; Lon = -68.7804 }
      Neighborhoods = @("Centro", "Russell", "Gutierrez", "Coquimbito")
      Streets = @("Ozamis", "Maza", "J J Paso", "Sarmiento", "Urquiza")
    },
    @{
      Department = "Lujan de Cuyo"
      Postal = "5507"
      Center = @{ Lat = -33.0395; Lon = -68.8803 }
      Neighborhoods = @("Centro", "Carrodilla", "Chacras de Coria", "La Puntilla")
      Streets = @("Saenz Pena", "San Martin", "Almirante Brown", "Paso", "Viamonte")
    },
    @{
      Department = "San Martin"
      Postal = "5570"
      Center = @{ Lat = -33.0810; Lon = -68.4686 }
      Neighborhoods = @("Centro", "Buen Orden", "Palmira", "Chapanay")
      Streets = @("Alem", "25 de Mayo", "Lavalle", "Sarmiento", "Balcarce")
    },
    @{
      Department = "Rivadavia"
      Postal = "5577"
      Center = @{ Lat = -33.1907; Lon = -68.4609 }
      Neighborhoods = @("Centro", "La Reduccion", "Mundo Nuevo", "Los Campamentos")
      Streets = @("San Isidro", "Lavalle", "Sarmiento", "Mariano Moreno", "Alem")
    },
    @{
      Department = "Tunuyan"
      Postal = "5560"
      Center = @{ Lat = -33.5769; Lon = -69.0155 }
      Neighborhoods = @("Centro", "Vista Flores", "La Primavera", "El Totoral")
      Streets = @("San Martin", "Belgrano", "Mitre", "Alem", "Roca")
    },
    @{
      Department = "San Rafael"
      Postal = "5600"
      Center = @{ Lat = -34.6177; Lon = -68.3301 }
      Neighborhoods = @("Centro", "Cuadro Nacional", "Las Paredes", "Villa 25 de Mayo")
      Streets = @("Hipolito Yrigoyen", "Mitre", "San Martin", "Balloffet", "Sarmiento")
    }
  )

  $firstNames = @("Lucia", "Mateo", "Valentina", "Tomas", "Malena", "Joaquin", "Mora", "Agustin", "Julieta", "Franco", "Camila", "Santino")
  $lastNames = @("Lopez", "Gimenez", "Sosa", "Rodriguez", "Pereyra", "Diaz", "Luna", "Garcia", "Sanchez", "Morales", "Fernandez", "Vega")

  $zone = Get-Random -InputObject $zones
  $street = Get-Random -InputObject $zone.Streets
  $neighborhood = Get-Random -InputObject $zone.Neighborhoods
  $number = Get-Random -Minimum 40 -Maximum 3999
  $lat = Get-RandomOffset -Base $zone.Center.Lat
  $lon = Get-RandomOffset -Base $zone.Center.Lon
  $name = "{0} {1}" -f (Get-Random -InputObject $firstNames), (Get-Random -InputObject $lastNames)
  $email = "qa.mendoza.{0:000}@example.com" -f $Index

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

Write-Host "API:" $ApiBase
Write-Host "Total pedidos a crear:" $Total

$products = Invoke-RestMethod -Uri "$ApiBase/products" -Method GET -TimeoutSec 30
if (-not $products) {
  throw "No se pudieron obtener productos desde /products"
}

$product = $products |
  Where-Object { $_.active -eq $true -and [double]($_.stock) -ge $Total -and [string]($_.sale_unit) -ne "kg" } |
  Sort-Object -Property @{ Expression = { [double]($_.stock) } } -Descending |
  Select-Object -First 1

if (-not $product) {
  $product = $products |
    Where-Object { $_.active -eq $true -and [string]($_.sale_unit) -ne "kg" } |
    Sort-Object -Property @{ Expression = { [double]($_.stock) } } -Descending |
    Select-Object -First 1
}

if (-not $product) {
  throw "No encontré un producto unitario activo para usar en la carga."
}

$ok = 0
$fail = 0
$createdIds = New-Object System.Collections.Generic.List[string]
$errors = New-Object System.Collections.Generic.List[string]

Write-Host ("Producto elegido: #{0} {1} | stock={2} | price={3}" -f $product.id, $product.name, $product.stock, $product.price)

for ($i = 1; $i -le $Total; $i++) {
  $address = New-MendozaAddress -Index $i
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
    $response = Invoke-RestMethod -Uri "$ApiBase/orders" -Method POST -ContentType "application/json" -Body ($payload | ConvertTo-Json -Depth 8) -TimeoutSec 30
    $ok++
    if ($response -and $response.id) {
      [void]$createdIds.Add([string]$response.id)
    }
    if (($i % 25) -eq 0 -or $i -eq $Total) {
      Write-Host ("Progreso: {0}/{1} | OK={2} | FAIL={3}" -f $i, $Total, $ok, $fail)
    }
  }
  catch {
    $fail++
    $msg = $_.Exception.Message
    if ([string]::IsNullOrWhiteSpace($msg)) {
      $msg = "error desconocido"
    }
    [void]$errors.Add(("pedido {0}: {1}" -f $i, $msg))
    Write-Warning ("Falló pedido {0}: {1}" -f $i, $msg)
  }

  if ($DelayMs -gt 0) {
    Start-Sleep -Milliseconds $DelayMs
  }
}

Write-Host ""
Write-Host ("RESULTADO OK={0} FAIL={1}" -f $ok, $fail)
if ($createdIds.Count -gt 0) {
  $preview = ($createdIds | Select-Object -First 20) -join ","
  Write-Host ("IDS_PRIMEROS_20={0}" -f $preview)
}
if ($errors.Count -gt 0) {
  Write-Host "ERRORES_MUESTRA:"
  $errors | Select-Object -First 10 | ForEach-Object { Write-Host $_ }
}
