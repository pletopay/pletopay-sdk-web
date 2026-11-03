export default defineEventHandler(() => {
  const client = usePletopayServer();
  return { mode: client.mode, baseUrl: client.baseUrl, same: client === usePletopayServer() };
});
