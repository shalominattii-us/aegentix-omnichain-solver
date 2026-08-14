$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw 'Python is required.'
}

python -m pip install -r requirements-public-data.txt
python -m uvicorn public_data_gateway:app --host 127.0.0.1 --port 8099
