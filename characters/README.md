# Character models

Put your `.vrm` files here.

Anything matching `characters/*.vrm` is gitignored, so models stay on your own
machine and NAS and are never pushed to the public repository. That is
deliberate: a VRM embeds the licence its author chose, and many forbid
redistribution — publishing one here would be exactly that.

On the NAS, nginx serves this directory, so a character can point at
`/characters/hername.vrm` and follow you to every device on the network. On a
device that can't reach the NAS, upload the file under **You → Characters**
instead and it is kept in that browser's IndexedDB.

Models come from [VRoid Studio](https://vroid.com/en/studio) (free — make your
own) or [VRoid Hub](https://hub.vroid.com/en). Both VRM 0.x and 1.0 work.
