

## Problem

When the user sends a **text message** with `@sokratai_ru_bot что видишь?` as a **reply to a photo message**, the bot treats it as a text-only message. The photo is in `reply_to_message.photo`, not in `update.message.photo`.

The routing logic (lines 8019-8074) only checks `update.message.photo` for the photo handler. It never looks at `reply_to_message.photo`.

## Fix

Modify the group chat routing block (lines 8069-8074) to also check `reply_to_message.photo` when the current message is a text reply to a photo:

```
Before (line 8069-8074):
  if (update.message.photo) {
    photo → handleGroupPhotoMessage
  } else {
    handleGroupTextMessage
  }

After:
  // Photo on the message itself
  const messagePhoto = update.message.photo;
  // Photo on the replied-to message (user replies to a photo with text + @mention)
  const replyPhoto = update.message.reply_to_message?.photo;
  const photo = messagePhoto || replyPhoto;

  if (photo) {
    const bestPhoto = photo[photo.length - 1];
    handleGroupPhotoMessage(... bestPhoto, questionText, replyContext);
  } else {
    handleGroupTextMessage(...);
  }
```

This is a ~5-line change in the routing block. The `handleGroupPhotoMessage` function already works correctly -- it downloads the photo by `file_id`, uploads to storage, and sends a multimodal request to the AI. The only missing piece is that the router never passes photos from `reply_to_message` to it.

## Files Changed

- `supabase/functions/telegram-bot/index.ts` -- group chat routing block (lines 8069-8075)

## Deployment

Redeploy `telegram-bot` edge function after the change.

