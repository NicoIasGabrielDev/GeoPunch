# Script de instalação rápida - GeoPunch com Supabase
# Execute este script após configurar as credenciais do Supabase no .env

Write-Host "🚀 Instalando dependências do GeoPunch + Supabase..." -ForegroundColor Cyan

# Verifica se está no ambiente virtual
if (-not $env:VIRTUAL_ENV) {
    Write-Host "⚠️  Aviso: Ambiente virtual não detectado" -ForegroundColor Yellow
    Write-Host "Você deseja ativar o ambiente virtual? (S/N)" -ForegroundColor Yellow
    $response = Read-Host
    
    if ($response -eq 'S' -or $response -eq 's') {
        if (Test-Path ".venv\Scripts\Activate.ps1") {
            Write-Host "Ativando .venv..." -ForegroundColor Green
            & .\.venv\Scripts\Activate.ps1
        } else {
            Write-Host "❌ Ambiente virtual não encontrado em .venv" -ForegroundColor Red
            Write-Host "Crie um com: python -m venv .venv" -ForegroundColor Yellow
            exit 1
        }
    }
}

# Instala dependências
Write-Host "`n📦 Instalando pacotes do requirements.txt..." -ForegroundColor Cyan
pip install -r requirements.txt

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Dependências instaladas com sucesso!" -ForegroundColor Green
    
    # Verifica se o .env está configurado
    Write-Host "`n🔍 Verificando configuração do .env..." -ForegroundColor Cyan
    
    $envContent = Get-Content .env -Raw
    
    if ($envContent -match 'SUPABASE_URL=https://your-project.supabase.co') {
        Write-Host "⚠️  ATENÇÃO: .env ainda não foi configurado!" -ForegroundColor Yellow
        Write-Host "`nPróximos passos:" -ForegroundColor Cyan
        Write-Host "1. Crie um projeto no https://supabase.com" -ForegroundColor White
        Write-Host "2. Execute o arquivo supabase_schema.sql no SQL Editor" -ForegroundColor White
        Write-Host "3. Copie SUPABASE_URL e SUPABASE_KEY de Settings > API" -ForegroundColor White
        Write-Host "4. Atualize o arquivo .env com suas credenciais" -ForegroundColor White
        Write-Host "5. Execute: python -m uvicorn server:app --reload" -ForegroundColor White
    } else {
        Write-Host "✅ Arquivo .env parece estar configurado!" -ForegroundColor Green
        Write-Host "`n🎯 Tudo pronto! Execute:" -ForegroundColor Cyan
        Write-Host "python -m uvicorn server:app --reload --host 127.0.0.1 --port 8000" -ForegroundColor Green
    }
    
    Write-Host "`n📖 Leia README_SUPABASE.md para instruções completas" -ForegroundColor Cyan
    
} else {
    Write-Host "❌ Erro ao instalar dependências" -ForegroundColor Red
    Write-Host "Verifique se o Python e pip estão instalados corretamente" -ForegroundColor Yellow
    exit 1
}

Write-Host "`n✨ Configuração concluída!" -ForegroundColor Green
