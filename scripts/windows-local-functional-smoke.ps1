param([Parameter(Mandatory=$true)][string]$ArtifactRoot,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference="Stop"
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$installer=@(Get-ChildItem $ArtifactRoot -Recurse -Filter "*setup.exe" -File)
if($installer.Count -ne 1){throw "Exactly one NSIS installer required"}
$report=@(Get-ChildItem $ArtifactRoot -Recurse -Filter "windows-verification.json" -File)
if($report.Count -ne 1){throw "Build report unavailable"}
$entries=ConvertFrom-Json -InputObject (Get-Content $report[0].FullName -Raw)
$expected=@(foreach($entry in $entries){if($entry.file -eq $installer[0].Name){$entry}})
if($expected.Count -ne 1){throw "Build report does not identify exactly one matching installer"}
$actualHash=(Get-FileHash -LiteralPath $installer[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if($actualHash -ne [string]$expected[0].sha256){throw "Installer SHA-256 mismatch: $actualHash versus $($expected[0].sha256)"}
$install=Start-Process -FilePath $installer[0].FullName -ArgumentList "/S" -Wait -PassThru
if($install.ExitCode -ne 0){throw "Silent installation failed: $($install.ExitCode)"}
$roots=@("$env:ProgramFiles\DS Mobile & Digital Hub","${env:ProgramFiles(x86)}\DS Mobile & Digital Hub","$env:LOCALAPPDATA\DS Mobile & Digital Hub")
$exe=@(foreach($root in $roots){if(Test-Path $root){Get-ChildItem $root -Recurse -File -Filter "ds_mobile_digital_hub.exe"}})
if($exe.Count -ne 1){throw "Installed application executable not found"}
# Enable native accessibility exposure for this isolated acceptance runner.
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--force-renderer-accessibility"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$proc=Start-Process $exe[0].FullName -PassThru
function Get-NativeNodes {
 $proc.Refresh()
 if($proc.HasExited){throw "Installed application exited"}
 if($proc.MainWindowHandle -eq 0){return @()}
 try{
  $root=[System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
  return @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition))
 }catch{return @()}
}
function Wait-Native([string]$Pattern,[string]$Phase) {
 for($i=0;$i -lt 40;$i++){
  $nodes=@(Get-NativeNodes)
  $names=@(foreach($node in $nodes){$node.Current.Name})
  $names | Set-Content (Join-Path $OutputDirectory "$Phase-accessibility.txt")
  if(($names -join " ") -match $Pattern){return}
  Start-Sleep -Seconds 2
 }
 throw "Native accessibility contract failed: $Phase"
}
function Invoke-NativeButton([string]$Pattern){
 $nodes=@(Get-NativeNodes)
 $matches=@($nodes|Where-Object{$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.IsEnabled -and $_.Current.Name -match $Pattern})
 if($matches.Count -ne 1){throw "Expected one native button: $Pattern (found $($matches.Count))"}
 $patternObj=$null
 if(!$matches[0].TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$patternObj)){throw "Native button does not support InvokePattern"}
 ([System.Windows.Automation.InvokePattern]$patternObj).Invoke()
}
try{
 Wait-Native "Owner Confidential Area.*Login \(ID / Password\)|Login \(ID / Password\).*Owner Confidential Area" "selection"
 Invoke-NativeButton "^Login \(ID / Password\)"
 Wait-Native "Android Access Area.*Login ID.*Password" "credentials"
 Invoke-NativeButton "^Login$"
 Wait-Native "Login ID aur Password dono bharo" "empty-credential-validation"
 Invoke-NativeButton "Back to selection"
 Wait-Native "Owner Confidential Area" "selection-return"
 Invoke-NativeButton "^Owner Confidential Area"
 Wait-Native "Create a private device PIN|Enter Owner Device PIN|Authorized personnel only" "owner-pin"
 # Dedicated ephemeral runner; a fresh device-only PIN, no cloud session.
 Add-Type -AssemblyName System.Windows.Forms
 function Set-NativeEdit([string]$Pattern,[string]$Value){
  $nodes=@(Get-NativeNodes)
  $matches=@($nodes|Where-Object{$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.IsEnabled -and $_.Current.Name -match $Pattern})
  if($matches.Count -ne 1){throw "Expected one native input: $Pattern (found $($matches.Count))"}
  $matches[0].SetFocus()
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait("^a")
  [System.Windows.Forms.SendKeys]::SendWait($Value)
  Start-Sleep -Milliseconds 150
 }
 Set-NativeEdit "^Create Owner Device PIN$" "5826"
 Set-NativeEdit "^Confirm Owner Device PIN$" "5826"
 Invoke-NativeButton "^Create PIN & Unlock$"
 Wait-Native "All Products" "local-owner-inventory"
 Wait-Native "Local only|Cloud Sign In" "local-only-scope"
 # Keyboard shortcut + calculator actual accessible buttons.
 [System.Windows.Forms.SendKeys]::SendWait("%k")
 Wait-Native "Counter calculator|Counter & retail tools" "calculator"
 Invoke-NativeButton "^All clear$"
 Invoke-NativeButton "^2$"
 Invoke-NativeButton "^Add$"
 Invoke-NativeButton "^3$"
 Invoke-NativeButton "^Equals$"
 Wait-Native "(^|\s)5(\s|$)" "calculator-result"
 Invoke-NativeButton "^Close calculator$"
 # Actual POS cart interaction without completing a real sale.
 Invoke-NativeButton "^Sales / New Bill$"
 Wait-Native "Custom Service" "pos"
 Invoke-NativeButton "Custom Service"
 Wait-Native "Service / Job Title" "service-modal"
 Set-NativeEdit "SIM Cutting|Service / Job Title" "CI Native Test Service"
 Set-NativeEdit "e.g. 50|Customer Charge" "50"
 Invoke-NativeButton "Add to Cart"
 Wait-Native "CI Native Test Service" "cart-result"

 @{installed=$true;loginScreenVerified=$true;emptyCredentialRejectionVerified=$true;backNavigationVerified=$true;ownerPinGateVerified=$true;localOwnerUnlockVerified=$true;calculatorVerified=$true;serviceCartVerified=$true;source=$expected[0].source;version=$expected[0].version;scope="Hosted Windows runner, no real account or hardware"} | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory "windows-runtime.json")
 Write-Host "PASS actual Windows installed app login, owner local PIN, calculator and synthetic POS service cart"
}finally{if(!$proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}}
