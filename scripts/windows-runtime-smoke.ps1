param([Parameter(Mandatory=$true)][string]$ArtifactRoot,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference="Stop"
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$installer=@(Get-ChildItem $ArtifactRoot -Recurse -Filter "*setup.exe" -File)
if($installer.Count -ne 1){throw "Exactly one NSIS installer required"}
$report=@(Get-ChildItem $ArtifactRoot -Recurse -Filter "windows-verification.json" -File)
if($report.Count -ne 1){throw "Build report unavailable"}
$expected=@(Get-Content $report[0].FullName -Raw | ConvertFrom-Json | Where-Object file -eq $installer[0].Name)
if($expected.Count -ne 1 -or (Get-FileHash $installer[0].FullName -Algorithm SHA256).Hash.ToLower() -ne $expected[0].sha256){throw "Installer SHA-256 mismatch"}
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
try{
 $found=$false
 for($i=0;$i -lt 40;$i++){
  Start-Sleep -Seconds 3
  $proc.Refresh()
  if($proc.HasExited){throw "Installed application exited before login"}
  if($proc.MainWindowHandle -eq 0){continue}
  try{
   $element=[System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
   $nodes=$element.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
   $names=@(foreach($n in $nodes){$n.Current.Name})
   $names | Set-Content (Join-Path $OutputDirectory "ui-accessibility.txt")
   $joined=$names -join " "
   if($joined -match "Owner Confidential Area" -and $joined -match "Login \(ID / Password\)"){$found=$true;break}
  }catch{Write-Host "Waiting for the native accessibility tree"}
 }
 if(!$found){throw "Windows login selection did not render in the native accessibility tree"}
 @{installed=$true;loginScreenVerified=$true;source=$expected[0].source;version=$expected[0].version;scope="Hosted Windows runner, no real account or hardware"} | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory "windows-runtime.json")
 Write-Host "PASS installed Windows application and rendered login selection"
}finally{if(!$proc.HasExited){Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue}}
