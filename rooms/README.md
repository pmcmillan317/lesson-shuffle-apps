# Lesson Shuffle Rooms

A very small relay that lets a teacher's screen and students' devices talk to each other during a classroom game (Huddle Up). The game page lives at https://apps.lessonshuffle.com/huddle-up/ and connects to this relay at rooms.lessonshuffle.com.

It is a Cloudflare Worker plus one Durable Object per game room. It passes messages along and forgets them.

## Privacy design, in plain words

This is built for NY Education Law 2-d, so the rules are strict.

- The relay stores no student data. Names, answers and scores are never written anywhere.
- The only thing ever saved to storage is the teacher's random host key and a created time. Both are deleted when the room ends.
- Everything else (who is connected, rate counters) lives only in memory or on the live socket, and disappears when the socket or room goes away.
- Nothing about message contents is logged. The code has no logging at all, and `wrangler.jsonc` switches Cloudflare's Workers Logs off. Please keep both that way.
- No cookies are set.
- Only the Lesson Shuffle pages may connect: https://apps.lessonshuffle.com, preview builds at https://<something>.lesson-shuffle-apps.pages.dev, and localhost for testing.
- A room ends when the teacher closes it, 15 minutes after everyone has left, or after 4 hours at most.

## Protocol

Connect with a WebSocket to `wss://rooms.lessonshuffle.com/room/<CODE>?role=host&key=<hostKey>` or `?role=player&pid=<pid>`.

- CODE is 6 characters from `A-H J-N P-Z 2-9` (no I, O, 0, 1). It is uppercased for you.
- hostKey and pid are 8 to 64 characters of `A-Za-z0-9_-`.
- Send the text `ping` to get `pong` (keeps the connection alive).

Server to host:
- `{"t":"hello","role":"host","players":[pid,...]}`
- `{"t":"join","pid":pid}` and `{"t":"leave","pid":pid}`
- `{"t":"from","pid":pid,"m":{...}}` a player's message

Server to player:
- `{"t":"hello","role":"player","host":true|false}`
- `{"t":"host","up":true|false}`
- `{"t":"closed"}` the room ended
- anything else is a message the host sent, passed along as is

Host to server:
- `{"to":"*"|pid|[pid,...],"m":{...}}` deliver `m` to everyone, one player, or a list
- `{"t":"close-room"}` end the room and wipe it

Errors arrive as `{"t":"error","code":...}` followed by a close:

| Code | Close | Meaning |
| --- | --- | --- |
| taken | 4003 | the room already has a different host key |
| no-room | 4004 | no host has created this room |
| full | 4005 | 80 players already connected |
| (replaced) | 4000 | the same host or player connected again |
| (rate) | 4008 | a player sent more than 40 messages in 10 seconds |
| (too big) | 1009 | a message was over its size limit |

Limits: player messages up to 2048 bytes, host messages up to 196608 bytes (192 KB, so a question can carry one small picture), all JSON objects. Anything else is ignored.

## One-time setup (owner)

1. In the Cloudflare dashboard go to Workers & Pages, then Create, then Import a repository.
2. Choose `pmcmillan317/lesson-shuffle-apps`.
3. Set the root directory to `rooms`.
4. Set the deploy command to `npx wrangler deploy`.
5. Deploy.

The deploy also creates the custom domain rooms.lessonshuffle.com, because lessonshuffle.com DNS is already on Cloudflare. After that, check https://rooms.lessonshuffle.com/health. It should say `ok`.

## Working on it

```
npm install
npm run dev     # local relay
npm test        # starts a local relay on port 8790 and runs the end to end test
npm run deploy
```

Note: the apps site (Cloudflare Pages) serves every file in this repo, so this folder's source is also visible at apps.lessonshuffle.com/rooms/. That is harmless (the repo is public and holds no secrets), and the relay itself runs only at rooms.lessonshuffle.com.
