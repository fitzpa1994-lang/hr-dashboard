param(
  [string]$PackagePath = "dist/hr-dashboard-zeabur.zip"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$resolvedPackage = Resolve-Path $PackagePath
$verifyRoot = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $verifyRoot | Out-Null
$tempRoot = Join-Path $verifyRoot ("package-verify-" + [guid]::NewGuid().ToString("N"))

function Assert-Exists {
  param([string]$Path, [string]$Label)
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label is missing: $Path"
  }
}

function Assert-NotExists {
  param([string]$Path, [string]$Label)
  if (Test-Path -LiteralPath $Path) {
    throw "$Label must not be included: $Path"
  }
}

try {
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  Expand-Archive -LiteralPath $resolvedPackage -DestinationPath $tempRoot -Force

  Assert-Exists (Join-Path $tempRoot "package.json") "root package.json"
  Assert-Exists (Join-Path $tempRoot "zbpack.json") "root zbpack.json"
  Assert-Exists (Join-Path $tempRoot "dashboard/server.js") "dashboard server"
  Assert-Exists (Join-Path $tempRoot "dashboard/index.html") "dashboard UI"
  Assert-Exists (Join-Path $tempRoot "scripts/verify_runtime.mjs") "runtime verifier"

  Assert-NotExists (Join-Path $tempRoot ".env") "root .env"
  Assert-NotExists (Join-Path $tempRoot "dashboard/.env") "dashboard .env"
  Assert-NotExists (Join-Path $tempRoot "node_modules") "root node_modules"
  Assert-NotExists (Join-Path $tempRoot "dashboard/node_modules") "dashboard node_modules"
  Assert-NotExists (Join-Path $tempRoot ".claude") "local Claude settings"
  Assert-NotExists (Join-Path $tempRoot "dist") "dist output"

  $secretHits = Get-ChildItem -LiteralPath $tempRoot -Recurse -File |
    Where-Object { $_.FullName -notmatch '\\.git\\' } |
    Select-String -Pattern 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' -ErrorAction SilentlyContinue
  if ($secretHits) {
    $firstHit = $secretHits | Select-Object -First 1
    throw "Package contains a JWT-like secret at $($firstHit.Path):$($firstHit.LineNumber)"
  }

  $packageJson = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $tempRoot "package.json") | ConvertFrom-Json
  if ($packageJson.scripts.start -ne "node dashboard/server.js") {
    throw "package.json start script must be 'node dashboard/server.js'"
  }

  $zeabur = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $tempRoot "zbpack.json") | ConvertFrom-Json
  if ($zeabur.start_command -ne "npm start") {
    throw "zbpack.json start_command must be 'npm start'"
  }

  Push-Location $tempRoot
  try {
    node --check dashboard/server.js
    if ($LASTEXITCODE -ne 0) {
      throw "dashboard server syntax check failed inside extracted package"
    }

    node --check scripts/verify_runtime.mjs
    if ($LASTEXITCODE -ne 0) {
      throw "runtime verifier syntax check failed inside extracted package"
    }

    node --check scripts/verify_deployment.mjs
    if ($LASTEXITCODE -ne 0) {
      throw "deployment verifier syntax check failed inside extracted package"
    }
  } finally {
    Pop-Location
  }

  Write-Host "Deployment package verification passed: $resolvedPackage"
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
