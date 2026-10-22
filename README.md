# ⚽ Yaston — la página del fútbol de los jueves

Web (sin instalar nada, HTML + JS) con:

- **Ver sin registrarse**: cualquiera con el link ve la tabla, los premios, los partidos y el plantel. Solo hace falta **entrar con Gmail (Google)** para **votar** o para **editar** (admin).
- **Plantel**: cargás jugadores con foto y nombre. Los que casi nunca vienen igual forman parte: aparecen en el plantel y al final de la tabla en gris, hasta que jueguen.
- **Invitados**: al armar un partido, "Sumar un invitado solo para este partido" agrega a alguien con solo el nombre. Aparece en la tabla (con la etiqueta *invitado*) pero no en el Plantel. Si el mismo invitado vuelve otro jueves y lo escribís igual (da igual mayúsculas o tildes), se cuenta como el mismo jugador y acumula sus partidos.
- **Partidos**: cada jueves armás los equipos A y B (hasta 5 por equipo), cargás quién ganó (y los goles si querés) y la **tabla se actualiza sola** (ganar 3 pts, empate 1, perder 0). Filtro por año o histórica. La tabla muestra el **promedio de victorias (%)** de cada uno, y tocando **%** o **Pts** en el encabezado se ordena por promedio (solo los que jugaron 3 o más partidos) o por puntos.
- **Jugador del partido**: los 10 que jugaron votan (voto secreto, no podés votarte, se puede cambiar hasta que cierres la votación). Al cerrar la votación se muestra el ganador y suma ⭐ en la tabla.
- **Torneos**: la Tabla se elige por torneo (arriba a la derecha). Por defecto abre el **Clausura 2026** (se calcula solo con los partidos cargados, 3-1-0). El **Apertura 2026** es la tabla final de la primera mitad del año, fija, con su puntaje propio (ganador 4, empate 2, perdedor 1), asistencia y promedio. El **Anual 2025** muestra solo al campeón. Abajo hay una tabla de **Títulos**. Los torneos y la tabla del Apertura están en `app.js` (`TORNEOS`, `APERTURA_2026`).
- **Premios** (se calculan solos): Más victorioso, Mejor promedio y Derrotado (el promedio cuenta desde 3 partidos), Fantasma (el que no viene nunca), Jugador del mes (más ⭐), mejor y peor racha histórica, Dupla letal y Dupla maldita, y un ranking de estrellas. En la tabla se marca 🔥 / 🥶 a quien lleva 3 o más victorias o derrotas seguidas.
- **Historial**: en el Plantel, el botón *Historial* de cada jugador muestra sus números, su mejor dupla, su bestia negra, y cuántas veces ganaron/perdieron juntos o enfrentados contra cualquier otro.
- **¿Quién sos?**: la primera vez que alguien entra con Google, la página le pide elegir su nombre de la lista (solo aparecen los que nadie eligió todavía). Queda vinculado a ese Gmail y ya puede votar. Si alguien se equivoca, el admin edita al jugador (Plantel → Editar) y borra o corrige el mail.
- **Juegos**: hay **un juego por semana** (la semana empieza el lunes). Esta semana: *Pateale Penales a Gure* (tanda de 5 penales, el arquero es la foto de Gure). Cada cuenta de Google puede jugar **hasta 3 veces por semana** y se abre una **tabla de la semana** (cuenta el mejor intento). **Para jugar y para votar al jugador del partido hay que entrar con Google**; para ver todo lo demás no. Para sumar el juego de otra semana se agrega una entrada en `WEEKLY_GAMES` de `app.js`; si no hay uno nuevo, sigue el último.
- Solo los **admins** (vos) cargan y editan; el resto solo mira y vota.

## Puesta en marcha (≈10 min, gratis)

### 1. Supabase (la base de datos y el login)
1. Creá una cuenta en https://supabase.com → **New project**.
2. **SQL Editor → New query**: pegá todo `schema.sql`, **cambiá `TU_MAIL@gmail.com` por tu Gmail** (línea 12) y tocá **Run**.
3. **Project Settings → API**: copiá `Project URL` y `anon public key` y pegalos en `config.js`.

### 2. Login con Google
1. https://console.cloud.google.com → creá un proyecto → **APIs y servicios → Pantalla de consentimiento** (tipo Externo) → **Credenciales → Crear ID de cliente OAuth → Aplicación web**.
2. En "URI de redirección autorizados" poné: `https://TU-PROYECTO.supabase.co/auth/v1/callback` (la URL de tu Supabase + `/auth/v1/callback`).
3. Copiá el *Client ID* y *Client Secret*.
4. En Supabase: **Authentication → Providers → Google** → activalo y pegá esos dos datos.
5. En Supabase: **Authentication → URL Configuration** → en *Site URL* poné la dirección final de tu página (paso 3) y agregala también en *Redirect URLs*.

### 3. Publicar la página
Subí la carpeta `yaston/` a cualquier hosting estático gratis: **Netlify** (arrastrar y soltar la carpeta en https://app.netlify.com/drop), **Vercel** o **GitHub Pages**. Pasale el link al grupo.

## Cómo se usa
1. Entrá con tu Gmail (el que pusiste de admin). Vas a ver los botones de agregar/editar.
2. **Plantel → + Jugador**: nombre, foto y **el Gmail de cada uno** (así, cuando entre con Google, la página sabe quién es y lo deja votar).
3. **Partidos → + Nuevo partido**: fecha (propone el último jueves), poné a cada uno en A o B, elegí quién ganó (o empate) y guardá. La votación queda abierta.
4. Los 10 entran, ven el partido y tocan al mejor jugador.
5. Cuando quieras, **🔒 Cerrar votación**: se muestra el MVP del partido y se suma en la tabla.

## Archivos
`index.html` · `styles.css` · `app.js` (toda la lógica) · `config.js` (tus claves de Supabase) · `schema.sql` (tablas, permisos y funciones).
