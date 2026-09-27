# Social agent API — Valuation Hallucination

Base URL: `https://www.valuationhallucination.com`

## 1. Fetch briefs (read only)

`GET /api/admin/growth?view=brief`

Header: `Authorization: Bearer <SOCIAL_AGENT_BRIEF_TOKEN>`

Returns `asset_folder` and up to 16 recent, editable social drafts. Each draft has `id`, `campaign_day`, `channel`, `caption`, `asset_brief`, `source_url`, `rationale`, `asset_url`, `status`. It does not return founder data, Reddit opportunities, admin credentials, or published assets. A missing or wrong token returns 401.

```bash
curl -sS 'https://www.valuationhallucination.com/api/admin/growth?view=brief' \
  -H "Authorization: Bearer $SOCIAL_AGENT_BRIEF_TOKEN"
```

## 2. Upload an actual image or reel to Drive

Connect Muse to the owner's Google Drive account with upload permission, or have an authorized editor upload. Put finished files in [02 Images and reels for review](https://drive.google.com/drive/folders/1P9dQSR_9i66kqSRfVQatyTtH4ylWOA9I). Name them `YYYY-MM-DD_platform_topic_v01.ext`. A brief or storyboard alone is not a finished MP4 reel. Muse needs its own Drive authorization; the brief API token does not grant Drive access.

## 3. Attach the Drive file to a draft (write limited to asset link)

`POST /api/admin/growth?view=asset`

Headers: `Authorization: Bearer <SOCIAL_AGENT_INGEST_TOKEN>` and `Content-Type: application/json`.

```bash
curl -sS -X POST 'https://www.valuationhallucination.com/api/admin/growth?view=asset' \
  -H "Authorization: Bearer $SOCIAL_AGENT_INGEST_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"post_id":123,"asset_url":"https://drive.google.com/file/d/FILE_ID/view"}'
```

Only the asset link on a draft awaiting review may be updated. Response: `{ "post_id": 123, "asset_url": "...", "status": "awaiting_review" }`. A wrong token returns 401; an invalid link returns 400; an uneditable post ID returns 404. This token also permits submitting new draft suggestions through the existing `view=submit` endpoint; store it as a secret, not in a prompt, query string, or Drive document.

## Credentials and workflow

Set two random, independent secrets as Vercel Production environment variables: `SOCIAL_AGENT_BRIEF_TOKEN` and `SOCIAL_AGENT_INGEST_TOKEN`. Give them to Muse using its secret/credential facility, if it has one. Never use `GROWTH_ADMIN_TOKEN` for Muse. Give Muse access to the Google Drive folder through its own Google Drive connection. Muse may then fetch briefs, produce images/reels, upload files, and attach their links. Don reviews caption plus media in `/growth`; approval stays human. Drive preview links are not direct public media URLs; Voholabs publishing still needs a tested delivery mechanism for the approved file.
