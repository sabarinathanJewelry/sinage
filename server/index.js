import express from "express";
import multer  from "multer";
import cors     from "cors";  
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
console.log("Supabase URL:", process.env.SUPABASE_URL);
console.log("Supabase Key:", process.env.SUPABASE_SERVICE_ROLE_KEY);
const upload   = multer({ storage: multer.memoryStorage() });
const app = express();
app.use(cors());
app.use(express.json()); 

/* ------------ multi‑file upload ----------------------------------- */
// Accept multiple files

// Upload Route (Multiple Files)
app.post("/api/upload", upload.array("files", 20), async (req, res) => {
   console.log("Received Upload Request"); 
  try {
      
    if (!req.files?.length) {
      return res.status(400).json({ error: "No files uploaded." });
    }

    const results = [];
    console.log("Received files:", req.files.length);
    for (const file of req.files) {
      const path = `${Date.now()}_${file.originalname}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("media")
        .upload(path, file.buffer, {
          contentType: file.mimetype,
        });

      if (uploadError) {
      console.error("Storage Upload Failed:", uploadError);
      return res.status(500).json({ error: "Storage Upload Failed", details: uploadError });
     }

      const publicURL = `${process.env.SUPABASE_URL}/storage/v1/object/public/media/${path}`;

      console.log("Uploaded File URL:", publicURL);

      // Insert metadata into media table
      const { data, error: insertError } = await supabase
        .from("media")
        .insert({
          file_url: publicURL,
          storage_path: path,  
          type: file.mimetype.startsWith("video") ? "video" : "image",
        })
        .select()
        .single();

      if (insertError) {
      console.error("Database Insert Failed:", insertError);
      return res.status(500).json({ error: "DB Insert Failed", details: insertError });
   }
    console.log("Inserted DB row:", data);
      results.push(data);
    }

    res.json({ media: results });

  } catch (err) {
    console.error("General Upload Route Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
/* ------------------------------------------------------------------ */

app.listen(8787, () => console.log("API on http://localhost:8787"));
/* ------------------------------------------------------------------ */
/* DELETE  /api/media/:id                                             */
/* ------------------------------------------------------------------ */
app.delete("/api/media/:id", async (req, res) => {
  try {
    const id = req.params.id;

    /* 1️⃣  find the row so we know the storage path */
    const { data: row, error: readErr } = await supabase
      .from("media")
      .select("file_url")
      .eq("id", id)
      .single();
    if (readErr) throw readErr;
    if (!row)    return res.status(404).json({ error: "not found" });

    /* 2️⃣  compute storage path (everything after /media/) */
    const parts = row.file_url.split("/media/");
    if (parts.length !== 2) throw new Error("bad file_url");
    const storagePath = parts[1];                       // e.g. 1692284499_image.jpg

    /* 3️⃣  delete from Storage bucket */
    const { error: storErr } = await supabase
      .storage.from("media")
      .remove([storagePath]);
    if (storErr) console.warn("storage remove", storErr.message);

    /* 4️⃣  delete playlist_items rows that use this media */
    const { error: piErr } = await supabase
      .from("playlist_items")
      .delete()
      .eq("media_id", id);
    if (piErr) console.warn("playlist_items delete", piErr.message);

    /* 5️⃣  delete the media row itself */
    const { error: delErr } = await supabase
      .from("media")
      .delete()
      .eq("id", id);
    if (delErr) throw delErr;

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST  /api/media/delete     (called by “Delete Selected” button)
app.post("/api/media/delete", async (req, res) => {
  try {
    const { ids } = req.body;
    console.log("DELETE ids:", ids);

    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ error: "ids array required" });

    /* 1️⃣  fetch rows */
    const { data: rows, error: readErr } = await supabase
      .from("media")
      .select("id, storage_path")
      .in("id", ids);
    if (readErr) throw readErr;
    console.log("ROWS FOUND:", rows.length, rows.map(r => r.id));

    console.log("ROWS BEFORE DELETE:", rows.length, rows.map(r => r.id));

    /* 2️⃣  storage keys */
    const storagePaths = rows.map(r => r.storage_path);   

    /* 3️⃣  delete from Storage */
    if (storagePaths.length) {
      console.log("Storage paths to delete:", storagePaths);
      const toRemove = storagePaths.map((p) => ({ path: p }));
      const { data: delRes, error: storErr } = await supabase
      .storage.from("media")
      .remove(storagePaths);  
      console.log("remove() →", { delRes, storErr });
    }

    /* 4️⃣  playlist_items */
    const { error: plErr, data: plData } = await supabase
      .from("playlist_items")
      .delete()
      .in("media_id", ids)
      .select();                               // return deleted rows
    if (plErr) throw plErr;
    console.log("PLAYLIST ITEMS DELETED:", plData.length);

    /* 5️⃣  media rows */
    const { data: delRows, error: delErr } = await supabase
      .from("media")
      .delete()
      .in("id", ids)
      .select();                               // return deleted rows
    if (delErr) throw delErr;

    console.log("MEDIA ROWS DELETED:", delRows.length);

    if (delRows.length === 0)
      return res.status(404).json({ error: "no rows deleted" });

    res.json({ success: true, deletedIds: delRows.map(r => r.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
/* ================================================================ */
/* 2. POST /api/playlist_item   add media to a playlist zone        */
/* ================================================================ */
/* body: { playlist_id, media_id, layout_id, zone, ordering, duration_sec } */
app.post("/api/playlist_item", express.json(), async (req, res) => {
  try {
    const { playlist_id, media_id, layout_id, zone, ordering, duration_sec } = req.body;
    if (!playlist_id || !media_id || !layout_id)
      return res.status(400).json({ error: "missing fields" });

    const { data, error } = await supabase
      .from("playlist_items")
      .insert({
        playlist_id,
        media_id,
        layout_id,
        zone,
        ordering,
        duration_sec,
      })
      .select()
      .single();
    if (error) throw error;

    res.json({ item: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
// POST /api/playlist_item/bulk
app.post("/api/playlist_item/bulk", async (req, res) => {
  try {
    const { playlist_id, layout_id, zone, duration_sec = 10, ids } = req.body;

    if (!playlist_id || !layout_id || !zone || !Array.isArray(ids) || !ids.length)
      return res.status(400).json({ error: "playlist_id, layout_id, zone, ids required" });

    // OPTIONAL: quick uuid format check
    const uuidRegex = /^[0-9a-f-]{36}$/i;
    if (!uuidRegex.test(layout_id))
      return res.status(400).json({ error: "layout_id must be uuid" });

    const rows = ids.map((media_id, i) => ({
      playlist_id,
      media_id,
      layout_id,          // ← now dynamic
      zone,
      ordering: i,
      duration_sec,
    }));

    const { data, error } = await supabase
      .from("playlist_items")
      .insert(rows)
      .select();

    if (error) throw error;

    res.json({ success: true, items: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
/* --- list playlists ------------------------------------------------ */
app.get("/api/playlists", async (req, res) => {
  const { data, error } = await supabase.from("playlists").select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/* --- list layouts -------------------------------------------------- */
app.get("/api/layouts", async (req, res) => {
  const { data, error } = await supabase.from("layouts").select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
