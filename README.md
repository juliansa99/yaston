# ⚽ Yaston — la página del fútbol de los jueves

Web (sin instalar nada, HTML + JS) con:

- **Ver sin registrarse**: cualquiera con el link ve la tabla, los premios, los partidos y el plantel. Solo hace falta **entrar con Gmail (Google)** para **votar** o para **editar** (admin).
- **Plantel**: cargás jugadores con foto y nombre. Los que casi nunca vienen igual forman parte: aparecen en el plantel y al final de la tabla en gris, hasta que jueguen.
- **Partidos**: cada jueves armás los equipos A y B (hasta 5 por equipo), cargás quién ganó (y los goles si querés) y la **tabla se actualiza sola** (ganar 3 pts, empate 1, perder 0). Filtro por año o histórica.
- **Jugador del partido**: los 10 que jugaron votan (voto secreto, no podés votarte, se puede cambiar hasta que cierres la votación). Al cerrar la votación se muestra el ganador y suma ⭐ en la tabla.
- **Premios** (se calculan solos): Más victorioso, Mejor promedio y Derrotado (el promedio cuenta desde 3 partidos), Fantasma (el que no viene nunca), Jugador del mes (más ⭐), mejor y peor racha histórica, Dupla letal y Dupla maldita, y un ranking de estrellas. En la tabla se marca 🔥 / 🥶 a quien lleva 3 o más victorias o derrotas seguidas.
- **Historial**: en el Plantel, el botón *Historial* de cada jugador muestra sus números, su mejor dupla, su bestia negra, y cuántas veces ganaron/perdieron juntos o enfrentados contra cualquier otro.
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
