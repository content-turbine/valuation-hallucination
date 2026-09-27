# Automatic Drive asset attachment

The growth app lists files in the private `02 Images and reels for review` folder and attaches matching links to editable `/growth` drafts. It uses Drive read-only access; the app does not upload, approve, or publish an asset.

1. In Google Cloud, enable the Google Drive API, create a service account and generate a JSON key. Add the complete JSON as a **Production** secret `SOCIAL_DRIVE_SERVICE_ACCOUNT_JSON` in Vercel. Redeploy after saving.
2. Share [02 Images and reels for review](https://drive.google.com/drive/folders/1P9dQSR_9i66kqSRfVQatyTtH4ylWOA9I) with the JSON `client_email` as **Viewer**. Do not make the folder public.
3. Finished assets can be uploaded without an existing post ID as `YYYY-MM-DD_<channel>_<topic>_v01.<extension>`, for example `2026-09-27_instagram_autopilot_v01.png` and `2026-09-27_tiktok_autopilot_v01.mp4`. Existing `post-<id>_<channel>_<topic>_v01.<extension>` filenames still match a specific draft. Use the local Toronto campaign date. Source briefs, scripts and storyboards are not treated as finished assets.
4. When Don opens Social campaigns, `/growth` checks Drive at most once every five minutes per warm function instance. “Check Drive for assets” checks immediately. Only image/png, image/jpeg, image/webp, video/mp4, video/quicktime and video/webm files are matched. A dated asset joins the existing draft for that day and channel, or creates an empty review slot so Don can set its text. The daily AI job fills an empty Drive-created slot with suggested copy without overwriting edited copy. Existing approved or scheduled posts are not modified by Drive sync.

The Drive file link is a review link, not a public media file. Scheduling through Voholabs still needs media delivery and a verified channel connection. Avoid placing the service account JSON in GitHub, Drive, or Muse chat.
