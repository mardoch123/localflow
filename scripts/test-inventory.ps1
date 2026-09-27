$ErrorActionPreference = 'Stop'
$base = 'http://localhost:4000/api'
function Login($e, $p) { Invoke-RestMethod "$base/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email = $e; password = $p } | ConvertTo-Json) }
$out = @()

# 1) Locataire kofi -> son contrat signe
$ten = Login 'kofi.mensah@locaflow.bj' 'Locaflow2026'
$ht = @{ Authorization = "Bearer $($ten.token)" }
$tContracts = @(Invoke-RestMethod "$base/contracts" -Headers $ht).data | Where-Object { $_.signedAt }
$tc = $tContracts[0]
$cid = $tc.id
$ownerId = $tc.landlordId
$out += "kofi contrat = $($tc.reference) / $($tc.property.name)"

# 2) Auto-creatio ENTRY attendue ? (le contrat a-t-il un EDL?)
$asLand = Login 'amara.diallo@locaflow.bj' 'Proprio2026'
# on ne sait pas si le proprio de ce contrat est amara ; on teste la CREATION via le meme token locataire? non.
# Utiliser un token admin pour creer (ADMIN autorise).
$adm = Login 'admin@locaflow.bj' 'SuperAdmin2026'
$ha = @{ Authorization = "Bearer $($adm.token)" }

# 3) CREATION d'un EDL de SORTIE (EXIT) par l'admin sur ce contrat -> 201 attendu
try {
  $body = @{ contractId = $cid; type = 'EXIT'; keysCount = 1; items = @(
      @{ room = 'Chambre 1'; element = 'Sol'; condition = 'Usage'; observation = 'rayures' },
      @{ room = 'Cuisine'; element = 'Evier'; condition = 'Endommage'; observation = 'fendu' }
    ) } | ConvertTo-Json -Depth 5
  $created = Invoke-RestMethod "$base/inventories" -Method Post -Headers $ha -ContentType 'application/json' -Body $body
  $invId = $created.data.id
  $out += "ADMIN CREATE EXIT ref=$($created.data.reference) items=$(@($created.data.items).Count) landlordSigned=$($created.data.signedByLandlord) status=$($created.data.status)"
} catch {
  $out += "CREATE EXIT status=$($_.Exception.Response.StatusCode.value__) msg=$($_.ErrorDetails.Message)"
  $ex = @(Invoke-RestMethod "$base/inventories?contractId=$cid" -Headers $ha).data | Where-Object { $_.type -eq 'EXIT' } | Select-Object -First 1
  $invId = $ex.id
}

# 4) PATCH par admin : remplacer items (brouillon) -> ok
try {
  $patch = @{ items = @(@{ room = 'Salon'; element = 'Murs'; condition = 'Bon' }); notes = 'revise' } | ConvertTo-Json -Depth 5
  $p = Invoke-RestMethod "$base/inventories/$invId" -Method Patch -Headers $ha -ContentType 'application/json' -Body $patch
  $out += "PATCH items=$(@($p.data.items).Count) notes=$($p.data.notes)"
} catch { $out += "PATCH err=$($_.Exception.Message)" }

# 5) SIGNATURE par le VRAI locataire (kofi) -> status SIGNED (admin/landlord a deja signe a la creation)
try {
  $sign = Invoke-RestMethod "$base/inventories/$invId/sign" -Method Post -Headers $ht -ContentType 'application/json' -Body (@{ tenantNotes = 'lu et approuve' } | ConvertTo-Json)
  $out += "TENANT SIGN status=$($sign.data.status) tenantSigned=$($sign.data.signedByTenant) landlordSigned=$($sign.data.signedByLandlord)"
} catch { $out += "SIGN err=$($_.Exception.Response.StatusCode.value__) msg=$($_.ErrorDetails.Message)" }

# 6) Acces croise : kofi ne doit PAS voir un EDL d'un contrat qui n'est pas le sien
$out += "kofi unread=$((Invoke-RestMethod "$base/notifications/unread-count" -Headers $ht).data.unread)"

$out | ForEach-Object { Write-Host $_ }
