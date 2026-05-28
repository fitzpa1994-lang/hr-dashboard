param(
  [string]$OutputDir = "dist",
  [string]$PackageName = "hr-dashboard-zeabur.zip"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required to create a deployment package."
}

$insideWorkTree = git rev-parse --is-inside-work-tree 2>$null
if ($LASTEXITCODE -ne 0 -or $insideWorkTree.Trim() -ne "true") {
  throw "This directory is not a Git working tree. Run git init and commit the project first."
}

$dirty = git status --porcelain
if ($dirty) {
  throw "Working tree is not clean. Commit or discard changes before packaging.`n$dirty"
}

$head = git rev-parse --short HEAD
if ($LASTEXITCODE -ne 0 -or -not $head) {
  throw "Unable to resolve HEAD commit."
}

$resolvedOutputDir = Join-Path $root $OutputDir
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

$packagePath = Join-Path $resolvedOutputDir $PackageName
if (Test-Path -LiteralPath $packagePath) {
  Remove-Item -LiteralPath $packagePath -Force
}

git archive --format=zip --output $packagePath HEAD
if ($LASTEXITCODE -ne 0) {
  throw "git archive failed."
}

$resolvedPackage = Resolve-Path $packagePath
Write-Host "Created deployment package: $resolvedPackage"
Write-Host "Commit: $head"
Write-Host "Upload this package only if GitHub/Zeabur Git deployment is unavailable."
