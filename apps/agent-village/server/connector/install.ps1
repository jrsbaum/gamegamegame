param([Parameter(Mandatory=$true)][string]$PairingCode)
$ErrorActionPreference = 'Stop'
$base = '__PUBLIC_ORIGIN__'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ("vila-agentes-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force $temporary | Out-Null
try {
  Invoke-WebRequest -UseBasicParsing "$base/connector/install.mjs" -OutFile (Join-Path $temporary 'install.mjs')
  Invoke-WebRequest -UseBasicParsing "$base/connector/logic.mjs" -OutFile (Join-Path $temporary 'logic.mjs')
  & node (Join-Path $temporary 'install.mjs') --origin $base --pairing-code $PairingCode
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $temporary
}
