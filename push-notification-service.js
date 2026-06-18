import webpush from 'web-push';

export function createPayload({ title, body, data }) {
  return JSON.stringify({
    title: title || 'Inventario Musical',
    body: body || 'La biblioteca ha sido actualizada',
    data: data || { url: './' },
  });
}

export async function sendPushBroadcast(subscriptions, payload, onInvalidSubscription) {
  const results = await Promise.all(
    subscriptions.map(async sub => {
      try {
        await webpush.sendNotification(sub, payload);
        return { ok: true, endpoint: sub.endpoint };
      } catch (error) {
        if ((error.statusCode === 410 || error.statusCode === 404) && onInvalidSubscription) {
          await onInvalidSubscription(sub.endpoint);
        }

        return {
          ok: false,
          endpoint: sub.endpoint,
          error: error.message,
          statusCode: error.statusCode || null,
        };
      }
    })
  );

  const sent = results.filter(result => result.ok).length;
  const failed = results.length - sent;

  return {
    sent,
    failed,
    results,
  };
}
