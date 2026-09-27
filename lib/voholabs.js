export async function connectedVoholabsChannels() {
  const key = process.env.VOHOLABS_API_KEY;
  const base = process.env.VOHOLABS_API_BASE || "https://studio.voholabs.com/api/";
  if (!key) throw new Error("Set VOHOLABS_API_KEY in Vercel first.");
  const origin = new URL(base);
  if (origin.protocol !== "https:" || !origin.hostname.endsWith(".voholabs.com")) {
    throw new Error("Voholabs API base must use an HTTPS voholabs.com host.");
  }
  const url = new URL("public/v1/integrations", base.endsWith("/") ? base : `${base}/`);
  const response = await fetch(url, {
    headers: { Authorization: key, Accept: "application/json" }, signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Voholabs connection returned ${response.status}.`);
  const channels = await response.json();
  if (!Array.isArray(channels)) throw new Error("Voholabs returned an unexpected channel list.");
  return channels.map(({ id, name, identifier, disabled }) => ({ id, name, identifier, disabled }));
}
