# GG Transfer

Aplicación de escritorio Windows para transferir archivos mediante WebRTC DataChannels P2P.

## Arquitectura
- Electron: interfaz y ejecutable Windows.
- WebRTC DataChannel: transporte de archivos cifrado con DTLS por el navegador Chromium.
- Servidor de señalización: intercambia SDP/ICE; no recibe los bytes de los archivos.
- STUN público: ayuda a negociar rutas directas.
- TURN: recomendado para redes restrictivas; requiere desplegar y configurar un servidor TURN propio.

## Estado de esta versión
Prototipo inicial 0.1.0. Incluye creación/unión de sala, señalización WebSocket, canal P2P y envío por bloques.
No incluye todavía reanudación de transferencias, TURN configurado, control de acceso empresarial, firma de instalador ni manejo de archivos gigantes mediante escritura en streaming a disco. Los archivos recibidos se mantienen en memoria hasta que el usuario los guarda; usar archivos moderados en esta versión.

## Requisitos de desarrollo
- Windows 10/11 x64
- Node.js 22 LTS

## Ejecutar en desarrollo
```powershell
npm install
npm start
```

## Construir el instalador
```powershell
npm run dist:win
```
El instalador estará en `dist/`.

## Publicar el servidor de señalización
1. Crea un servicio Node en Render desde este repositorio.
2. Usa `render.yaml` o configura `Root Directory=signaling`, `Build Command=npm install`, `Start Command=npm start`.
3. Copia el dominio HTTPS asignado y conviértelo a `wss://...`.
4. En la app, reemplaza `wss://TU-SERVIDOR-DE-SENALIZACION` por esa dirección.

El servidor solo reenvía mensajes de señalización. No almacena ni retransmite archivos. Para una conexión directa entre redes distintas, la conectividad depende de NAT/firewall. En redes donde P2P directo falle, desplegar TURN (coturn) y agregar sus credenciales a `iceServers` en `src/renderer.js`.

## Publicar el EXE en GitHub
- Sube el contenido de este proyecto al repositorio `ggarridog01-tech/archivos_transfer`.
- GitHub Actions construye el instalador en Windows.
- Para publicar un Release, crea y sube un tag `v0.1.0`.

## Seguridad y limitaciones
- WebRTC DataChannels usan DTLS para cifrar el transporte.
- Usa únicamente un servidor de señalización bajo tu control y verifica el dominio antes de compartir códigos.
- El código corto de sala es temporal y no debe tratarse como autenticación de identidad.
- El servidor de señalización incluido es una base de prototipo: antes de uso público se debe añadir rate limiting, expiración de salas, límites por IP, métricas y pruebas de carga.
- No uses este prototipo para datos sensibles o transferencias críticas hasta completar una revisión de seguridad.
