
# SJ TV Display System

## Folders

* **player/** – `player.html` → open this on each Android TV browser with `?screen={UUID}`
* **admin/**  – React admin (login & upload). Run:

```bash
cd admin
npm install
npm run dev  # dev server
```

* **schema.sql** – paste into Supabase SQL editor.

## Quick Start

1. Create a Supabase project, enable Row Level Security, and run `schema.sql`.
2. Create a **`media`** storage bucket in Supabase.
3. Copy the `player/player.html` URL and open on TV (add `?screen=SCREEN_UUID` once you add a screen row).
4. In **admin/.env**, set:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

5. `npm run build` → deploy `admin/dist` & `player/` to Vercel or any static host.

That's it!
