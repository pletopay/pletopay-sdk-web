export default definePletopayWebhookHandler({
  handlers: {
    'payment.succeeded': (event) => {
      seen.push(`${event.type}:${event.data.object.reference}`);
    },
    '*': (event) => {
      seen.push(`*:${event.id}`);
    },
  },
});

export const seen: string[] = [];
