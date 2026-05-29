# Quick Notes — mobile app spec

Build a small but complete personal notes app.

## Core features
- A home screen listing all notes (title + preview + relative timestamp), newest first.
- Create a new note, edit an existing note, and delete a note.
- A search box on the home screen that filters notes by title/body as you type.
- Notes persist locally on the device and survive app restarts.
- Pull-to-refresh and a friendly empty state when there are no notes.

## Screens
- Notes list (home).
- Note editor (create + edit, reached from list).

## Non-functional
- Clean, modern, accessible UI with light/dark support.
- Loading, empty, and error states handled everywhere.
- No backend — fully local. No login.

## Target
- Native Android (Kotlin + Jetpack Compose). Ready for a signed release AAB and
  Google Play upload.
