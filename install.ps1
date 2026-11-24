# Instala Transferir en Windows desde la última release, para el usuario actual
# y sin derechos de administrador. En PowerShell:
#
#   irm https://raw.githubusercontent.com/TU-USUARIO/transferir/main/install.ps1 | iex
#
# Descarga transferir.exe desde GitHub, lo comprueba con el SHA-256 que GitHub
# publica para él y lo añade al PATH del usuario. No necesita Python.
# Ejecutarlo de nuevo actualiza la instalación. Opcional:
#
#   $env:TRANSFERIR_VERSION = 'v0.1.0'   instala esa release en vez de la última
#   $env:GITHUB_TOKEN = '...'            para un fork privado, o para evitar límites de la API
#
# Funciona en Windows PowerShell 5.1 y PowerShell 7.

& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest es mucho más rápido sin barra
    $repo = 'TU-USUARIO/transferir'            # <-- cambia esto por tu usuario/repositorio

    function Stop-Install($message) {
        Write-Host $message -ForegroundColor Red
        throw 'Transferir no se instaló.'
    }

    if ([Environment]::OSVersion.Platform -ne 'Win32NT') {
        Stop-Install 'Este instalador es para Windows. En Linux/macOS ejecuta transferir.py con Python.'
    }
    # Windows PowerShell 5.1 puede ofrecer solo versiones antiguas de TLS.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $headers = @{ 'User-Agent' = 'transferir-install'; 'Accept' = 'application/vnd.github+json' }
    if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $env:GITHUB_TOKEN" }
    $which = if ($env:TRANSFERIR_VERSION) { "tags/$env:TRANSFERIR_VERSION" } else { 'latest' }
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/$which" -Headers $headers
    } catch {
        Stop-Install "No se encontró la release '$which' de $repo en GitHub: $($_.Exception.Message)"
    }
    $asset = $release.assets | Where-Object { $_.name -eq 'transferir.exe' } | Select-Object -First 1
    if (-not $asset) { Stop-Install "La release $($release.tag_name) no incluye transferir.exe." }

    $running = Get-Process transferir -ErrorAction SilentlyContinue
    if ($running) {
        Stop-Install 'Transferir se está ejecutando. Ciérralo (o espera a que termine la transferencia) y vuelve a ejecutar esto.'
    }

    $installed = Join-Path $env:LOCALAPPDATA 'Programs\Transferir'
    $folder = Join-Path ([IO.Path]::GetTempPath()) ("transferir-install-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory $folder | Out-Null
    try {
        $exe = Join-Path $folder $asset.name
        Write-Host "Descargando $($asset.name) ($([Math]::Round($asset.size / 1MB, 1)) MB)..."
        if ($env:GITHUB_TOKEN) {
            # Un repositorio privado solo sirve sus archivos a través de la API.
            $download = @{ 'User-Agent' = 'transferir-install'; 'Accept' = 'application/octet-stream'; 'Authorization' = "Bearer $env:GITHUB_TOKEN" }
            Invoke-WebRequest -Uri $asset.url -Headers $download -OutFile $exe -UseBasicParsing
        } else {
            Invoke-WebRequest -Uri $asset.browser_download_url -Headers @{ 'User-Agent' = 'transferir-install' } -OutFile $exe -UseBasicParsing
        }

        $size = (Get-Item $exe).Length
        if ($size -ne $asset.size) { Stop-Install "La descarga está incompleta: $size bytes de $($asset.size)." }
        if ($asset.digest -match '^sha256:([0-9a-f]{64})$') {
            $hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($hash -ne $Matches[1]) { Stop-Install 'La descarga no coincide con el SHA-256 que GitHub publica para ella.' }
            Write-Host 'Comprobado con el SHA-256 publicado en GitHub.'
        } else {
            Write-Host 'GitHub no publica SHA-256 para este archivo; solo se comprobó el tamaño.' -ForegroundColor Yellow
        }

        Write-Host "Instalando Transferir $($release.tag_name) para $env:USERNAME..."
        New-Item -ItemType Directory $installed -Force | Out-Null
        Copy-Item $exe (Join-Path $installed 'transferir.exe') -Force
        # Restos de versiones anteriores basadas en Python
        Remove-Item (Join-Path $installed 'transferir.py'), (Join-Path $installed 'transferir.cmd') -Force -ErrorAction SilentlyContinue
    } finally {
        Remove-Item $folder -Recurse -Force -ErrorAction SilentlyContinue
    }

    # PATH del usuario
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @()
    if ($userPath) { $entries = $userPath.Split(';') | Where-Object { $_ } }
    if ($entries -notcontains $installed) {
        [Environment]::SetEnvironmentVariable('Path', ((@($entries) + $installed) -join ';'), 'User')
    }
    if (($env:Path.Split(';')) -notcontains $installed) { $env:Path = "$env:Path;$installed" }

    Write-Host "Transferir $($release.tag_name) está instalado en $installed." -ForegroundColor Green
    Write-Host 'Abre una terminal nueva y ejecuta:  transferir enviar archivo.zip --relay mi-servidor.com'
}
