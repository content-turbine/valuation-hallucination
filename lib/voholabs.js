const baseUrl = () => {
  const base = process.env.VOHOLABS_API_BASE || 'https://studio.voholabs.com/api/';
  const origin = new URL(base);
  if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.voholabs.com')) throw new Error('Voholabs API base must use an HTTPS voholabs.com host.');
  return base.endsWith('/') ? base : `${base}/`;
};

async function call(path, options = {}) {
  const key = process.env.VOHOLABS_API_KEY;
  if (!key) throw new Error('Set VOHOLABS_API_KEY in Vercel first.');
  const response = await fetch(new URL(`public/v1/${path}`, baseUrl()), {
    ...options, headers: { Authorization: key, Accept: 'application/json', ...options.headers },
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Voholabs ${path} returned ${response.status}: ${JSON.stringify(result).slice(0, 350)}`);
  return result;
}

export async function connectedVoholabsChannels() {
  const channels = await call('integrations');
  if (!Array.isArray(channels)) throw new Error('Voholabs returned an unexpected channel list.');
  return channels.map(({ id, name, identifier, disabled }) => ({ id, name, identifier, disabled }));
}

export async function uploadVoholabsMedia(bytes, mime, name) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), name);
  const media = await call('upload', { method: 'POST', body: form });
  if (!media.id || !media.path) throw new Error('Voholabs upload did not return a media ID and path.');
  return { id: media.id, path: media.path };
}

export async function scheduleVoholabsPost(post, media) {
  const channel = post.channel === 'instagram' ? 'instagram' : post.channel;
  const connected = (await connectedVoholabsChannels()).filter(c => !c.disabled && c.identifier === channel);
  if (connected.length !== 1) throw new Error(`Expected one connected ${channel} account in Voholabs; found ${connected.length}.`);
  const settings = channel === 'x' ? { who_can_reply_post: 'everyone' }
    : channel === 'instagram' ? { post_type: 'post' }
    : channel === 'facebook' ? { post_type: 'post' }
    : { privacy_level: 'PUBLIC_TO_EVERYONE', duet: false, stitch: false, comment: true,
      autoAddMusic: 'no', brand_content_toggle: false, brand_organic_toggle: true,
      content_posting_method: 'DIRECT_POST' };
  const result = await call('posts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'schedule', shortLink: false, date: new Date(post.scheduled_at).toISOString(), tags: [],
      posts: [{ integration: { id: connected[0].id }, value: [{ content: post.caption, image: media ? [media] : [] }], settings }] }) });
  if (!Array.isArray(result) || result.length !== 1 || !result[0].postId) throw new Error('Voholabs returned no scheduled post ID; check its calendar before retrying.');
  return result[0].postId;
}
