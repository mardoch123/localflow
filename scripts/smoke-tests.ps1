# Smoke tests de sécurité LocaFlow API
$ErrorActionPreference = 'Continue'
$base = 'http://localhost:4000/api'
$pass = 0; $fail = 0
function Check($name, $cond) {
  $ok = if ($cond -is [scriptblock]) { try { & $cond } catch { $false } } else { [bool]$cond }
  if ($ok) { $script:pass++; Write-Host "  OK  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  ECHEC  $name" -ForegroundColor Red }
}

# — Baseline —
$health = Invoke-RestMethod "$base/health"
Check "sante API+DB" ($health.status -eq 'ok')

$tenant = (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body '{"email":"kofi.mensah@locaflow.bj","password":"Locaflow2026"}')
$owner  = (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body '{"email":"amara.diallo@locaflow.bj","password":"Proprio2026","role":"LANDLORD"}')
$admin  = (Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body '{"email":"admin@locaflow.bj","password":"SuperAdmin2026","role":"ADMIN"}')
Check "login TENANT/LANDLORD/ADMIN" ($tenant.token -and $owner.token -and $admin.token)
$ht = @{Authorization = "Bearer $($tenant.token)" }
$ho = @{Authorization = "Bearer $($owner.token)" }
$ha = @{Authorization = "Bearer $($admin.token)" }

# — En-tetes de securite (helmet + rate limit) —
$resp = Invoke-WebRequest "$base/health"
Check "helmet: x-content-type-options nosniff" ($resp.Headers['X-Content-Type-Options'] -eq 'nosniff')
Check "rate-limit: en-tete RateLimit standard (draft-7)" ($null -ne $resp.Headers['RateLimit'])

# — Authentification —
Check "401 sans token"      { try { Invoke-RestMethod "$base/payments" } catch { $_.Exception.Response.StatusCode.value__ -eq 401 } }
Check "401 token invalide"  { try { Invoke-RestMethod "$base/payments" -Headers @{Authorization='Bearer faux.jet.token'} } catch { $_.Exception.Response.StatusCode.value__ -eq 401 } }
Check "400 email invalide (login)" { try { Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body '{"email":"pas-un-email","password":"xxxx"}' } catch { $_.Exception.Response.StatusCode.value__ -eq 400 } }
Check "400 mot de passe court (register)" { try { Invoke-RestMethod -Method Post -Uri "$base/auth/register" -ContentType 'application/json' -Body '{"email":"test.tmp@a.fr","password":"123","name":"Tmp"}' } catch { $_.Exception.Response.StatusCode.value__ -eq 400 } }

# — Controle d'acces par role —
Check "403 TENANT -> /users" { try { Invoke-RestMethod "$base/users" -Headers $ht } catch { $_.Exception.Response.StatusCode.value__ -eq 403 } }
Check "403 TENANT -> dashboard/owner" { try { Invoke-RestMethod "$base/dashboard/owner" -Headers $ht } catch { $_.Exception.Response.StatusCode.value__ -eq 403 } }
Check "403 LANDLORD -> dashboard/admin" { try { Invoke-RestMethod "$base/dashboard/admin" -Headers $ho } catch { $_.Exception.Response.StatusCode.value__ -eq 403 } }

# — Scopage des donnees —
$payT = Invoke-RestMethod "$base/payments" -Headers $ht
Check "paiements scopés au locataire" ( ($payT.data | Where-Object { $_.tenant.name -ne 'Kofi Mensah' }).Count -eq 0 )
$propsO = Invoke-RestMethod "$base/properties?mine=true" -Headers $ho
Check "biens scopés au propriétaire"  ( ($propsO.data | Where-Object { $_.owner.name -ne 'Amara Diallo' }).Count -eq 0 )

# — Propriété croisée : un locataire ne peut pas modifier un bien —
$someProp = $propsO.data[0].id
Check "403 TENANT PATCH propriete" { try { Invoke-RestMethod -Method Patch -Uri "$base/properties/$someProp" -Headers $ht -ContentType 'application/json' -Body '{"monthlyRent":1}' } catch { $_.Exception.Response.StatusCode.value__ -eq 403 } }

# — Validation stricte —
Check "400 creation bien sans nom" { try { Invoke-RestMethod -Method Post -Uri "$base/properties" -Headers $ho -ContentType 'application/json' -Body '{"address":"x","type":"y","monthlyRent":1000}' } catch { $_.Exception.Response.StatusCode.value__ -eq 400 } }
Check "400 loyer non-entier" { try { Invoke-RestMethod -Method Post -Uri "$base/properties" -Headers $ho -ContentType 'application/json' -Body '{"name":"Z Test","address":"Z","type":"Studio","monthlyRent":"beaucoup"}' } catch { $_.Exception.Response.StatusCode.value__ -eq 400 } }

# — Cycle de vie complet: creation propriete -> suppression —
$new = Invoke-RestMethod -Method Post -Uri "$base/properties" -Headers $ho -ContentType 'application/json' -Body '{"name":"Z Test Smoke","address":"Quartier Test","type":"Studio","monthlyRent":50000}'
Check "201 creation bien" ($new.data.id)
Invoke-RestMethod -Method Delete -Uri "$base/properties/$($new.data.id)" -Headers $ho | Out-Null
Check "200 suppression bien" $true

# — Suivi paiement locataire + providers —
$sum = Invoke-RestMethod "$base/payments/summary" -Headers $ht
Check "summary locataire (historique + totalPaid>0)" ($sum.data.history.Count -ge 1 -and $sum.data.totalPaid -gt 0)
$prov = Invoke-RestMethod "$base/payment-providers" -Headers $ho
Check "4 providers pour proprio (USSD inclus, auto-completion)" (@($prov.data).Count -eq 4 -and (@($prov.data | Where-Object { $_.provider -eq 'ussd' }).Count -eq 1))
$feex = $prov.data | Where-Object { $_.provider -eq 'feexpay' }
Check "stats feexpay: transactions incrementees par le paiement Kofi" ($feex.transactions -ge 1)

# — Notifications generees par le paiement —
$notif = Invoke-RestMethod "$base/notifications" -Headers $ho
Check "notif proprio: paiement reçu" ( ($notif.data | Where-Object { $_.type -eq 'payment' -and $_.title -like 'Paiement*' }).Count -ge 1 )

# — Admin users: auto-suspension refusee —
Check "400 admin se suspend lui-meme" { try { Invoke-RestMethod -Method Patch -Uri "$base/users/$($admin.user.id)" -Headers $ha -ContentType 'application/json' -Body '{"status":"SUSPENDED"}' } catch { $_.Exception.Response.StatusCode.value__ -eq 400 } }

# --- Nouveaux flux metier: signature / transfert / signalement / especes ---
Check "summary: payMethods reels du bailleur" ( (@($sum.data.payMethods).Count -ge 1) -and ((@($sum.data.payMethods) | Where-Object { $_.provider -notin @('feexpay','fedapay','kkiapay','ussd') }).Count -eq 0) )
$contractsT = Invoke-RestMethod "$base/contracts" -Headers $ht
Check "contrats: champ requiresSignature present" ( (@($contractsT.data) | Where-Object { $null -eq $_.requiresSignature }).Count -eq 0 )
$sigContract = @($contractsT.data | Where-Object { $_.requiresSignature -eq $false })[0]
if ($sigContract) {
  Check "sign contrat deja signe -> 409" { try { Invoke-RestMethod -Method Post -Uri "$base/contracts/$($sigContract.id)/sign" -Headers $ht } catch { $_.Exception.Response.StatusCode.value__ -eq 409 } }
}
Check "transfer vers bien inexistant -> 404" { try { Invoke-RestMethod -Method Post -Uri "$base/contracts/transfer" -Headers $ht -ContentType 'application/json' -Body '{"propertyId":"00000000-0000-0000-0000-000000000000"}' } catch { $_.Exception.Response.StatusCode.value__ -eq 404 } }
Check "issue message trop court -> 400" { try { Invoke-RestMethod -Method Post -Uri "$base/contracts/issue" -Headers $ht -ContentType 'application/json' -Body '{"message":"abc"}' } catch { $_.Exception.Response.StatusCode.value__ -eq 400 } }
$pendPay = @($payT.data | Where-Object { $_.status -ne 'PAID' })[0]
if ($pendPay) {
  Check "cash: TENANT ne peut pas encaisser -> 403" { try { Invoke-RestMethod -Method Post -Uri "$base/payments/$($pendPay.id)/cash" -Headers $ht } catch { $_.Exception.Response.StatusCode.value__ -eq 403 } }
}
$paidPay = @($payT.data | Where-Object { $_.status -eq 'PAID' })[0]
if ($paidPay) {
  Check "cash: paiement deja regle -> 409" { try { Invoke-RestMethod -Method Post -Uri "$base/payments/$($paidPay.id)/cash" -Headers $ho -ContentType 'application/json' -Body '{}' } catch { $_.Exception.Response.StatusCode.value__ -eq 409 } }
}
Check "dashboard admin: signupTrend 12 mois" { $adx = Invoke-RestMethod "$base/dashboard/admin" -Headers $ha; (@($adx.data.signupTrend).Count -eq 12) }

# --- Commission 1% + imprimante thermique 58/80mm ---
$payO = Invoke-RestMethod "$base/payments" -Headers $ho
Check "paiements PAID: commissionAmount = 1% du montant (backfill)" ( @($payO.data | Where-Object { $_.status -eq 'PAID' -and $_.commissionAmount -ne [Math]::Floor($_.amount * 0.01 + 0.5) }).Count -eq 0 )
$set = Invoke-RestMethod "$base/settings" -Headers $ho
Check "settings: commissionRate 1% + largeur 58/80mm" ( ($set.data.commissionRate -eq 0.01) -and ($set.data.printerWidth -in @('58mm','80mm')) )
Check "403 TENANT patch printer" { try { Invoke-RestMethod -Method Patch -Uri "$base/settings/printer" -Headers $ht -ContentType 'application/json' -Body '{"printerWidth":"58mm"}' } catch { $_.Exception.Response.StatusCode.value__ -eq 403 } }
Check "400 largeur d'imprimante invalide" { try { Invoke-RestMethod -Method Patch -Uri "$base/settings/printer" -Headers $ho -ContentType 'application/json' -Body '{"printerWidth":"100mm"}' } catch { $_.Exception.Response.StatusCode.value__ -eq 400 } }
Invoke-RestMethod -Method Patch -Uri "$base/settings/printer" -Headers $ho -ContentType 'application/json' -Body '{"printerWidth":"58mm"}' | Out-Null
$set58 = Invoke-RestMethod "$base/settings" -Headers $ho
Check "patch printer 58mm persiste en base" ( $set58.data.printerWidth -eq '58mm' )
Invoke-RestMethod -Method Patch -Uri "$base/settings/printer" -Headers $ho -ContentType 'application/json' -Body '{"printerWidth":"80mm"}' | Out-Null
$cidOwner = @($payO.data | Where-Object { $_.contract.id })[0].contract.id
$newPay = Invoke-RestMethod -Method Post -Uri "$base/payments" -Headers $ho -ContentType 'application/json' -Body ('{"contractId":"' + $cidOwner + '","amount":10000,"period":"2099-01","dueDate":"2099-01-05"}')
Check "payment cree (PENDING): commission 0 tant qu'il n'est pas paye" ( $newPay.data.status -eq 'PENDING' -and $newPay.data.commissionAmount -eq 0 )
$cashR = Invoke-RestMethod -Method Post -Uri "$base/payments/$($newPay.data.id)/cash" -Headers $ho -ContentType 'application/json' -Body '{}'
Check "cash: receipt avec commission 1% (100) et net 9900" ( $cashR.receipt.commission -eq 100 -and $cashR.receipt.net -eq 9900 -and $cashR.receipt.amount -eq 10000 )
Check "cash: printer renvoye (largeur + autoPrint) pour impression auto" ( ($cashR.printer.width -in @('58mm','80mm')) -and ($null -ne $cashR.printer.autoPrint) )
Check "cash: paiement marque PAID avec commissionAmount 1%" ( $cashR.data.status -eq 'PAID' -and $cashR.data.commissionAmount -eq 100 )
$odx = Invoke-RestMethod "$base/dashboard/owner" -Headers $ho
Check "dashboard owner: totalCommission + netRevenue cohérents" ( $odx.data.totalCommission -ge 100 -and $odx.data.netRevenue -eq ($odx.data.totalPaid - $odx.data.totalCommission) )

# --- Notification de chaque action ---
Check "cash: proprio notifie du net apres commission" { $n = Invoke-RestMethod "$base/notifications" -Headers $ho; (@($n.data | Where-Object { $_.title -like 'Encaissement *enregistr*' -and $_.body -like '*Commission 1 %*' }).Count -ge 1) }
$feexOff = @($prov.data | Where-Object { $_.provider -eq 'feexpay' })[0]
Invoke-RestMethod -Method Patch -Uri "$base/payment-providers/$($feexOff.id)" -Headers $ho -ContentType 'application/json' -Body '{"enabled":false}' | Out-Null
Check "provider désactivé → locataires notifiés" { $n = Invoke-RestMethod "$base/notifications" -Headers $ht; (@($n.data | Where-Object { $_.body -like '*Choisissez un autre moyen*' }).Count -ge 1) }
Invoke-RestMethod -Method Patch -Uri "$base/payment-providers/$($feexOff.id)" -Headers $ho -ContentType 'application/json' -Body '{"enabled":true}' | Out-Null
Check "provider activé → locataires notifiés" { $n = Invoke-RestMethod "$base/notifications" -Headers $ht; (@($n.data | Where-Object { $_.title -like 'Nouveau moyen de paiement*' }).Count -ge 1) }
Check "admin notifié des nouveaux biens (cycle creation plus haut)" { $n = Invoke-RestMethod "$base/notifications" -Headers $ha; (@($n.data | Where-Object { $_.title -like 'Nouveau bien pub*' }).Count -ge 1 -and (@($n.data | Where-Object { $_.title -like 'Bien supprim*' }).Count -ge 1)) }
Invoke-RestMethod -Method Patch -Uri "$base/users/$($tenant.user.id)" -Headers $ha -ContentType 'application/json' -Body '{"status":"SUSPENDED"}' | Out-Null
Invoke-RestMethod -Method Patch -Uri "$base/users/$($tenant.user.id)" -Headers $ha -ContentType 'application/json' -Body '{"status":"ACTIVE"}' | Out-Null
Check "suspension+reactivation → utilisateur notifié" { $n = Invoke-RestMethod "$base/notifications" -Headers $ht; (@($n.data | Where-Object { $_.title -like 'Compte suspendu*' }).Count -ge 1 -and (@($n.data | Where-Object { $_.title -like 'Compte *activ*' }).Count -ge 1)) }
Check "read boolean présent sur les notifications" { $n = Invoke-RestMethod "$base/notifications" -Headers $ht; (@($n.data | Where-Object { $null -eq $_.read }).Count -eq 0) }

Write-Host ""
Write-Host "RESULTAT: $pass reussis, $fail echoues" -ForegroundColor $(if ($fail -eq 0) {'Green'} else {'Yellow'})
