# Chismosito

Grabadora de reuniones para Windows 11 con transcripción **local** (whisper.cpp) y resumen automático con un LLM (OpenCode Zen compatible con OpenAI).

Captura el micrófono y el audio del sistema al mismo tiempo, separa quién habla (`Yo` / `Otros`), transcribe sin subir el audio a la nube y guarda una nota Markdown junto al archivo de audio.

---

## Requisitos

- Windows 11 x64.
- Node.js 22.12 o superior (probado con Node 24).
- npm o pnpm.
- Micrófono y un dispositivo de salida de audio activos.
- Una API key de OpenCode para el resumen (opcional: sin ella se guarda la transcripción).

No se necesita CMake, Visual Studio ni ffmpeg: los binarios de whisper.cpp para Windows ya están incluidos.

---

## Instalación (desarrollo)

Con npm:

```powershell
npm install
npm run dev
```

Con pnpm:

```powershell
pnpm install
pnpm dev
```

La primera instalación descarga el binario de Electron. Si el binario falta (por ejemplo, tras un `pnpm install` con scripts bloqueados), `pnpm dev` lo descarga automáticamente antes de arrancar.

Para generar el instalador:

```powershell
npm run build:win
# o
pnpm build:win
```

El instalador queda en `dist/`. No está firmado, así que Windows SmartScreen puede pedir confirmación.

---

## Configuración

### LLM

La **API key** se configura dentro de la app: **Ajustes → Resumen con LLM → API key de OpenCode**. Se guarda cifrada con DPAPI (Windows) en `%APPDATA%\chismosito\secrets.json`, nunca se envía al renderer y se aplica al instante (sin reiniciar). La misma key se usa para el resumen, el chat y Jev. Puedes quitarla desde el mismo panel.

El modelo se elige en **Ajustes → Resumen con LLM → Modelo**: la app pide `GET /models` al endpoint configurado con tu API key y arma la lista (DeepSeek V4.1 Flash, Claude Haiku 5.5, Kimi, GLM, Qwen, MiMo…). Si la API no responde, cae en una lista local de respaldo y lo indica bajo el selector. También puedes escribir un ID a mano con «Otro modelo».

El endpoint y el modelo por defecto se siguen leyendo del `.env` (copia `.env.example` a `.env`). El default es OpenCode Go (`/go/openai/v1`), que pide el ID de modelo sin prefijo:

```dotenv
LLM_BASE_URL=https://opencode.ai/inference/go/openai/v1
LLM_MODEL=deepseek-v4.1-flash
```

Los modelos incluidos en Go (`deepseek-v4.1-flash`, `deepseek-v4-pro`, `kimi-k3.1-pro`, `glm-5.3`, `claude-haiku-5.5`, …) solo están en esa ruta. `claude-sonnet-5` no forma parte del plan Go: con él hay que cambiar `LLM_BASE_URL` a la ruta de pago por uso (`https://opencode.ai/inference/openai/v1`). Si DeepSeek aparece bloqueado, activa **Global** en Console → Settings → Privacy → Regions.

La app se identifica con `User-Agent: chismosito/<versión>` y manda `x-opencode-session` con un id estable por conversación (hilo de chat o trabajo de resumen), que es lo que Go pide para enrutar y cachear por separado.

Si un `.env` antiguo todavía trae `OPENCODE_API_KEY` y no existe `secrets.json`, la app la adopta una sola vez en el primer arranque, la guarda cifrada y **borra esa línea del `.env`** dejando un respaldo `.env.bak` **sin la key**. Si más adelante vuelve a aparecer una key en el `.env`, Ajustes muestra un aviso con un botón para limpiarla; la app siempre usa la de Ajustes.

La key solo se escribe si Windows ofrece cifrado (DPAPI/safeStorage). Si no está disponible, la app falla cerrado y muestra el error en vez de guardar la clave en claro. Si el archivo guardado no se puede descifrar, Ajustes lo indica y permite reemplazar la key.

`https://opencode.ai/inference` es la raíz del gateway de OpenCode. La app la normaliza automáticamente a `https://opencode.ai/inference/openai/v1` (pago por uso), que es la ruta compatible con el SDK de OpenAI; para OpenCode Go usa la ruta explícita `/go/openai/v1`. También puedes escribir la ruta completa; se respeta tal cual. Este comportamiento de la raíz se mantiene por compatibilidad con los `.env` existentes.

Modelos sugeridos:

- `deepseek-v4.1-flash` — económico, buen equilibrio.
- `claude-haiku-5.5` — rápido.
- `claude-sonnet-5` — mejor calidad.

Si la API responde que el modelo no está disponible o que el acceso está desactivado, actívalo en **OpenCode Console → Models** y revisa los créditos del workspace. También puedes probar la conexión desde **Ajustes → Resumen con LLM → Probar conexión**.

El modelo se puede sobrescribir desde Ajustes sin editar el `.env`.

### Modelos de transcripción

El catálogo incluye todos los `ggml-*.bin` de whisper.cpp (tiny → large-v3, con f16/q8_0/q5_0/q5_1). En **Ajustes → Transcripción** la app:

- Detecta tu equipo (`nvidia-smi` para VRAM, RAM total y núcleos) y marca tres perfiles: **Más rápido**, **Equilibrado** y **Mejor calidad** (en 4 GB: `turbo-q5_0`, `turbo-q8_0` y `large-v3-q5_0`; con 12 GB la máxima calidad pasa a `large-v3-f16`; en CPU nunca se recomienda más de `small`).
- Muestra primero los sugeridos ("Sugeridos para tu equipo"), después el resto de multilingües y al final los solo-inglés; por modelo indica peso, VRAM y RAM estimadas y si cabe en tu GPU o iría por CPU.
- Descarga con reanudación (`.part`), verifica **sha256** contra el catálogo y registra lo instalado en `models/index.json`.
- Agrupa al final los modelos **solo inglés** (`EN`): no transcriben español.
- Permite borrar modelos que no estés usando y elegir un `.bin` propio (se valida la cabecera `ggml` y se referencia donde esté, sin copiarlo).

`WHISPER_MODEL_PATH` en el `.env` sigue teniendo prioridad y equivale a elegir un modelo propio.

### Jev (sugerencia de carpetas)

Jev es el modelo System One de TypeSafe, disponible a través de OpenCode Console. No genera texto: recibe el resumen de la reunión y las carpetas existentes, y devuelve la carpeta que mejor encaja con una probabilidad.

```dotenv
JEV_MODEL=jev-1.13-free
JEV_BASE_URL=https://opencode.ai/inference/systemone/v1/systemone
```

- Usa la misma API key configurada en **Ajustes → Resumen con LLM**.
- `jev-1.13-free` es gratis por tiempo limitado; `jev-1.13` es de pago y muy económico.
- El modelo se puede cambiar desde **Ajustes → Resumen con LLM → Modelo de Jev**.
- **Probar Jev** valida la conexión sin procesar una nota.
- Si no hay carpetas, Jev no tiene nada que proponer. Créalas en **Ajustes → Carpetas**.

### Google Drive (opcional)

La app usa OAuth 2.0 con el permiso mínimo `drive.file` y crea su propia carpeta en Drive; no necesita una carpeta existente.

1. Entra a [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Crea un proyecto y habilita **Google Drive API**.
3. Configura la pantalla de consentimiento (tipo External). Si la app queda en modo *Testing*, agrega tu cuenta como test user.
4. Crea un cliente OAuth de tipo **Desktop app**.
5. Copia las credenciales al `.env`:

```dotenv
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_DRIVE_FOLDER_NAME=Chismosito
GOOGLE_DRIVE_AUTO_BACKUP=true
```

6. Abre **Ajustes → Google Drive → Conectar Google Drive**. Se abrirá el navegador y el token se guardará cifrado con DPAPI (`safeStorage`).

**Importante:** los proyectos OAuth en modo *Testing* emiten refresh tokens que caducan a los 7 días. Para uso diario, publica la app como *En producción* (aunque quede sin verificar). También puedes poner un `GOOGLE_REFRESH_TOKEN` ya emitido en el `.env`; en ese caso la app no abre el navegador.

El respaldo es unidireccional (local → Drive) y espeja la estructura de `MeetingNotes/` dentro de `Chismosito/`. El audio solo se sube si el respaldo está activo.

### Rutas y preferencias

```dotenv
MEETING_NOTES_DIR=C:\Users\tu_usuario\Documents\MeetingNotes
USER_NAME=TuNombre
WHISPER_DEVICE=auto      # auto | cpu | cuda
WHISPER_LANGUAGE=es      # es | auto | en | pt | fr | de | it | ja | zh
WHISPER_MODEL_PATH=      # opcional: ruta a un .bin ggml propio (tiene prioridad)
```

- En desarrollo, el `.env` vive en la raíz del proyecto.
- En la app instalada, el `.env` vive en `%APPDATA%\chismosito\.env`. Puedes abrirlo desde Ajustes.
- Los cambios en `.env` se aplican al reiniciar Chismosito.
- `USER_NAME` se usa para asignarte acciones en el resumen.

---

## Primer uso

1. **Modelo de transcripción:** elige uno en **Ajustes → Transcripción**. La app detecta tu GPU/RAM, marca el **Recomendado** y ofrece el catálogo completo de whisper.cpp (tiny → large-v3, con sus cuantizaciones f16/q8_0/q5_0/q5_1). Se descarga solo, con reanudación y verificación sha256, y se guarda en `%APPDATA%\chismosito\models`. Los modelos marcados **EN** solo transcriben inglés; para español usa los multilingües (los primeros de la lista). La app incluye el modelo Silero VAD (~885 KB) para ignorar silencios y evitar alucinaciones.
2. **Micrófono:** autoriza el acceso. Si Windows lo bloquea, abre Configuración › Privacidad y seguridad › Micrófono.
3. **Audio del sistema:** Windows 11 lo captura mediante loopback de Chromium; no necesitas instalar controladores. En algunas configuraciones Windows muestra un indicador de captura de pantalla.
4. **GPU opcional:** si tienes NVIDIA, descarga el pack CUDA desde Ajustes (~650 MB; ~1.4 GB en disco). En una RTX 4060, la transcripción es aproximadamente 5 veces más rápida que en CPU. Si el pack falla, la app usa CPU automáticamente.
5. **Carpetas:** crea al menos una en **Ajustes → Carpetas** si quieres que Jev proponga dónde guardar cada reunión. Sin carpetas existentes no hay sugerencias.
6. **API key:** agrégala en **Ajustes → Resumen con LLM** para el resumen, el chat y las sugerencias. Sin clave, la transcripción y el audio siguen funcionando.

---

## Uso

### Guía rápida

1. **Prepara la app la primera vez.** Descarga el modelo de transcripción y autoriza el micrófono. Si tienes NVIDIA, puedes instalar el pack CUDA para transcribir más rápido. Agrega tu API key en **Ajustes → Resumen con LLM** si quieres resumen automático, chat y sugerencias de carpeta.
2. **Crea tus carpetas.** Entra a **Ajustes → Carpetas** y crea las categorías que uses normalmente (por ejemplo, `Producto`, `Ventas`, `Operaciones`). Puedes crear subcarpetas escribiendo `Producto/Q4`. Jev solo puede sugerir carpetas que ya existan.
3. **Elige las fuentes de audio.** En la pantalla **Grabar** activa el micrófono y/o el audio del sistema. Usa audífonos para evitar que el micrófono capture el audio de las bocinas.
4. **Graba la reunión.** Pulsa el botón grande o usa `Ctrl+Shift+R`. Al detener, el audio se guarda y comienza la transcripción en segundo plano. Puedes seguir usando la app o cerrarla a la bandeja.
5. **Espera el procesamiento.** En **En proceso** verás el avance. Al terminar se crea la nota con resumen, decisiones, acciones y transcripción. Si algo falla, la tarjeta te permite reintentar o abrir la nota.
6. **Revisa la nota.** Abre la nota desde **Recientes** o **Biblioteca**. Haz clic en cualquier timestamp de la transcripción para escuchar ese momento del audio.
7. **Acepta la sugerencia de carpeta.** Si Jev encontró una carpeta existente que encaja, verás un banner: **Mover a «Carpeta»**, **Elegir otra** o **Descartar**. El chip `Sugerencia: …` también aparece en Biblioteca/Home. La nota nunca se mueve sola.
8. **Pregunta sobre una reunión.** Abre la nota y entra a la pestaña **Preguntar**. Sirve para detalles que no están en el resumen: «¿qué se dijo del presupuesto?», «¿quién quedó de revisar esto?». Las respuestas citan momentos concretos y puedes hacer clic en la cita para saltar al audio.
9. **Pregunta a toda la biblioteca.** Usa **Preguntar** en la barra lateral. Puedes filtrar por fecha (hoy, esta semana, este mes o un rango) y por carpeta. Ejemplo: «¿qué tareas me asignaron esta semana?». Las respuestas muestran las reuniones consultadas.
10. **Respaldar.** Si conectas Google Drive en Ajustes, puedes respaldar una nota, todas las notas o las conversaciones. El respaldo automático se configura en **Ajustes → Google Drive**.

### Lo que puedes hacer con cada nota

- **Grabar:** elige micrófono y/o audio del sistema y pulsa el botón. También puedes usar el atajo global (`Ctrl+Shift+R` por defecto) o el menú de la bandeja.
- **Detener:** al detener se guarda el WebM/Opus y comienza el procesamiento en segundo plano. Puedes seguir usando la app o cerrarla a la bandeja.
- **Procesamiento:** primero transcribe tu pista (`Yo`) y la del sistema (`Otros`) con whisper.cpp y Silero VAD; luego fusiona los segmentos con timestamps y llama al LLM para el resumen, las decisiones y las acciones. Si una pista quedó incompleta o sin señal, transcribe el audio completo del WebM y lo etiqueta como `Mixto`.
- **Nota:** se escribe en `MeetingNotes/YYYY-MM-DD-HH-MM.md`, con el audio `YYYY-MM-DD-HH-MM.webm` al lado.
- **Historial:** la biblioteca permite buscar por título, resumen, carpeta, etiqueta o **transcripción**, agrupa por fecha y muestra el estado de cada nota.
- **Carpetas y etiquetas:** «Editar» permite cambiar título, etiquetas y carpeta. Al mover una nota se mueve también su audio. Las notas sin carpeta quedan en la raíz de `MeetingNotes/`.
- **Gestionar carpetas:** en **Ajustes → Carpetas** puedes crear carpetas (incluidas subcarpetas con `/`), renombrarlas y eliminarlas. Al eliminar una carpeta, todas sus notas y audios se mueven a **Sin clasificar**. Las acciones de renombrar/eliminar se bloquean mientras hay una grabación o un procesamiento activo.
- **Sugerencia de carpeta:** al terminar de procesar una nota nueva sin carpeta, Jev propone una carpeta existente según el título, el resumen, las decisiones y las acciones. La sugerencia aparece como banner en la nota y como chip en Biblioteca/Home; puedes **Mover**, **Elegir otra** o **Descartar**. Nunca se mueve automáticamente.
- **Audio:** cada nota incluye un reproductor; al hacer clic en un timestamp de la transcripción salta a ese momento.
- **Preguntar por reunión:** la pestaña **Preguntar** de cada nota abre un chat sobre esa grabación. Las respuestas citan momentos `[HH:MM:SS]` y puedes hacer clic en la cita para saltar al audio.
- **Chat global:** la entrada **Preguntar** de la barra lateral busca en todas tus reuniones. Sirve para preguntas transversales como «¿qué tareas me asignaron esta semana?». Las respuestas muestran las reuniones consultadas.
- **Filtros del chat global:** limita por fecha (hoy, esta semana, este mes o un rango) y por carpeta. Los filtros se guardan con la conversación y se aplican antes de buscar.
- **Respaldo:** si Drive está conectado, puedes respaldar una nota desde su vista o todo desde Ajustes. El respaldo automático se activa al terminar el procesamiento. Los chats se respaldan en `Conversaciones/` si activas **Respaldar conversaciones**.
- **Regenerar resumen:** si el LLM falló, aparece un botón para reintentar sin volver a transcribir.
- **Reprocesar audio:** vuelve a transcribir el WebM original de principio a fin (útil si una nota quedó con una transcripción incompleta). Antes de reemplazar la nota guarda una copia `*.md.bak`.
- **Bandeja:** cerrar la ventana la oculta; la grabación y el procesamiento continúan. «Salir» desde la bandeja pide confirmación si hay trabajo en curso.

### Ajustes que conviene revisar

- **General:** tu nombre (para asignarte acciones), idioma de transcripción, tema y carpeta de notas.
- **Carpetas:** crea, renombra o elimina carpetas. Crear carpetas antes de grabar mejora las sugerencias de Jev.
- **Resumen con LLM:** modelo del resumen, activar/desactivar la sugerencia de carpeta y modelo de Jev.
- **Google Drive:** conectar la cuenta, respaldo automático de notas y respaldo de conversaciones.
- **Escritorio:** atajo global, inicio con Windows y comportamiento al cerrar la ventana.

### Preguntas frecuentes

- **¿Jev movió mi nota a una carpeta equivocada?** No la mueve solo. Si aceptaste una sugerencia equivocada, abre la nota y usa **Editar** para moverla a otra carpeta o a **Sin clasificar**.
- **¿Por qué no aparece una sugerencia de carpeta?** Jev solo propone carpetas existentes. Si no tienes carpetas, o si la nota ya estaba archivada cuando se procesó, no habrá sugerencia. Crea carpetas y usa **Regenerar resumen** para volver a calcularla.
- **¿Dónde quedaron las notas de una carpeta eliminada?** En **Sin clasificar**. Eliminar una carpeta nunca borra notas; si dentro hay archivos que no son notas ni audios, la app aborta la operación para no borrar nada inesperado.
- **¿Los chats se respaldan en Drive?** Sí, si activas **Respaldar conversaciones**. Se guardan como JSON en `Chismosito/Conversaciones/`. El respaldo es unidireccional: no se restauran automáticamente.
- **¿Puedo usar la app sin API key?** Sí. La transcripción y el audio funcionan, pero no habrá resumen, chat ni sugerencias de carpeta.

### Formato de la nota

```markdown
---
title: "Planificación Q4"
date: "2026-11-14T15:30:00-06:00"
duration_seconds: 3720
language: "es"
audio: "2026-11-14-15-30.webm"
folder: "Producto"
suggested_folder: "Producto/Q4"
suggested_folder_confidence: 0.91
tags: ["q4", "planning"]
source: "chismosito"
llm: "deepseek-v4.1-flash"
status: "complete"
---

# Planificación Q4 — 14 de noviembre de 2026, 15:30

## Resumen

- … 5 viñetas …

## Decisiones

- **…** — contexto

## Acciones

| Acción | Responsable | Fecha límite |
| --- | --- | --- |
| … | Carlos | 2026-11-20 |

---

## Transcripción

[00:00:12] **Yo:** …
[00:00:31] **Otros:** …
```

`status` puede ser `processing`, `complete`, `summary_failed`, `transcription_failed` o `cancelled`.

---

## Datos y privacidad

- La transcripción ocurre **en tu equipo** con whisper.cpp. El audio no se envía a ningún lado durante la transcripción.
- Solo la transcripción se envía al proveedor del LLM para generar el resumen.
- El chat envía al proveedor únicamente la transcripción o los fragmentos relevantes de las notas que consultes, más el historial reciente de esa conversación.
- Jev recibe el título, el resumen, las decisiones, las acciones, los temas y los nombres/ejemplos de tus carpetas. No recibe el audio ni la transcripción completa.
- El historial de chats vive en `%APPDATA%\chismosito\chats\` (un JSON por conversación). No se escribe dentro de las notas.
- El audio, la nota y, si lo activas, los chats se suben a Google Drive.
- La API key vive cifrada con DPAPI en `%APPDATA%\chismosito\secrets.json` y nunca se envía al renderer (solo un hint enmascarado). El respaldo `.env.bak` se guarda sin la key. El refresh token de Google se guarda cifrado con DPAPI.
- Logs locales: `%APPDATA%\chismosito\logs\app.log`.

---

## Estructura del proyecto

```
src/
  main/        proceso principal: audio, whisper, LLM, Jev, notas, chat, Drive, tray
  preload/     puente IPC tipado
  renderer/    React + Tailwind
  shared/      tipos y constantes compartidas
resources/
  whisper/     whisper-cli.exe + DLLs (CPU), modelo Silero VAD
  tray/        iconos de bandeja
  icon.png
tests/         pruebas unitarias (Vitest)
```

---

## Pruebas

```powershell
npm test
npm run typecheck
```

Las pruebas cubren la normalización de la URL del LLM, la fusión/deduplicación de hablantes, el filtro de bucles de whisper, los argumentos de whisper-cli (VAD y anti-bucle), el formato de las notas, la escritura de WAV, el parseo de resumen/acciones, la recuperación y filtros del chat, el almacén de conversaciones, la clasificación de carpetas con Jev y la gestión de carpetas.

---

## Limitaciones conocidas

- Solo Windows 11 x64. El loopback de audio del sistema de Electron no está disponible en macOS/Linux con esta implementación.
- No hay transcripción en vivo; se procesa al detener.
- Los hablantes se separan en `Yo` (micrófono) y `Otros` (sistema); no hay diarización entre varios participantes remotos.
- El loopback captura todo el audio de salida, no solo la reunión.
- No hay firma de código ni actualizaciones automáticas en esta versión.
- El respaldo de chats en Drive es unidireccional: no se restauran automáticamente.
- El chat usa búsqueda por palabras clave y un planificador del LLM; no hay embeddings ni índice vectorial.
- Jev solo puede sugerir carpetas que ya existan y nunca mueve la nota automáticamente. Si no hay carpetas, no hay sugerencia.
- Renombrar una carpeta solo cambia el último segmento; no la mueve a otro padre. Eliminar una carpeta mueve sus notas a Sin clasificar, nunca las borra.
- Con bocinas, el micrófono puede captar el audio del sistema. La app intenta eliminar la copia duplicada, pero se recomienda usar audífonos.
- Si cambias el dispositivo de salida a mitad de una reunión, puede ser necesario reiniciar la captura.
- Si la captura por pista falla o queda incompleta, la transcripción se genera desde el audio completo y los fragmentos se etiquetan como `Mixto`, sin separación de hablantes.

---

## Licencia

MIT. whisper.cpp se distribuye bajo licencia MIT; el modelo de Whisper también es MIT. Consulta los avisos en `resources/whisper/`.

FFmpeg se incluye mediante `ffmpeg-static` y se distribuye bajo GPL-3.0-or-later. La app lo ejecuta como proceso separado para decodificar WebM/Opus a WAV al reprocesar una nota. El binario y sus licencias quedan en `node_modules/ffmpeg-static/` (y en `app.asar.unpacked` al instalar).
