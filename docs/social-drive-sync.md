# Automatic Drive asset attachment

The growth app lists files in the private `02 Images and reels for review` folder and attaches matching links to editable `/growth` drafts. It uses Drive read-only access; the app does not upload, approve, or publish an asset.

1. In Google Cloud, enable the Google Drive API, create a service account and generate a JSON key. Add the complete JSON as a **Production** secret `SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON` in Vercel. Redeploy after saving.
2. Share [02 Images and reels for review](https://drive.google.com/drive/folders/1P9dQSR_9i66kqSRfVQatyTtH4ylWOA9I) with the JSON `client_email` as **Viewer**. Do not make the folder public.
3. Muse reads the draft ID, channel and visual brief from the already connected brief API and uploads to that folder using `post-<id>_<channel>_<topic>_v01.<extension>`. For example: `post-123_instagram_autopilot_v01.png` or `post-124_tiktok_autopilot_v01.mp4`.
4. When Don opens Social campaigns, `/growth` checks Drive at most once every five minutes per warm function instance. “Sync Drive assets” checks immediately. Only image/png, image/jpeg, image/webp, video/mp4, video/quicktime and video/webm files are matched. The newest file for a post is chosen, but existing links are not overwritten. The filename channel must match the draft channel. The matched draft remains unapproved until Don reviews it.

The Drive file link is a review link, not a public media file. Scheduling through Voholabs still needs media delivery and a verified channel connection. Avoid placing the service account JSON in GitHub, Drive, or Muse chat.
