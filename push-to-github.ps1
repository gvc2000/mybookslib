$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$env:GIT_DIR = Join-Path $root "git-meta"
$env:GIT_WORK_TREE = $root

git remote set-url origin "https://github.com/gvc2000/mybookslib.git"
git push -u origin main
