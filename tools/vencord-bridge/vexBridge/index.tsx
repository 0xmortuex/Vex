/*
 * Vencord userplugin: VexBridge
 *
 * Writes `vex-bridge.json` (schema vex-bridge/1, see docs/vencord-bridge.md in the Vex repository) with the
 * owner's own mentions, replies to the owner's own messages, and the last messages of chosen channels, for the
 * Vex browser to read. It is a READ-ONLY plugin: it sends, reacts, edits and changes nothing in Discord, and it
 * sends nothing anywhere; the file is written only to a folder the owner chooses.
 *
 * NOT BUILT OR RUN YET: this file was written inside the Vex repository and has never been compiled against
 * Vencord (the build lives in the owner's Vencord checkout). Copy this folder to <vencord>/src/userplugins/vexBridge,
 * run `pnpm build` (or `pnpm buildWeb`) and fix any import path that drifted. See README.md.
 *
 * Two ways to write the file:
 *   - Vencord Desktop (Electron): native.ts writes the file with Node (atomic: tmp + rename).
 *   - Web / browser extension (Vex's Discord panel): the File System Access API. The owner presses "Choose the
 *     folder" in the plugin settings (a click is required), picks the SAME folder as in Vex, and the plugin writes
 *     through that handle. The browser asks again after a restart; until then nothing is written and the plugin
 *     says so in the console.
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, FluxDispatcher, GuildStore, MessageStore, UserStore } from "@webpack/common";

import { BridgeMessage, buildBridge, serialise } from "./bridgeData";

const logger = new Logger("VexBridge");
const FILE = "vex-bridge.json";

const settings = definePluginSettings({
    channelIds: {
        type: OptionType.STRING,
        description: "Channel IDs whose last messages go into the catch-up (comma separated, at most 20)",
        default: ""
    },
    perChannel: {
        type: OptionType.NUMBER,
        description: "Messages kept per channel (1 to 100)",
        default: 50
    },
    includeDms: {
        type: OptionType.BOOLEAN,
        description: "Also write mentions and replies that arrive in direct messages (off: server channels only)",
        default: false
    },
    keep: {
        type: OptionType.NUMBER,
        description: "How many mentions and replies to keep (1 to 200 each)",
        default: 100
    }
});

// Remembered in memory for this session: the newest first.
const mentions: BridgeMessage[] = [];
const replies: BridgeMessage[] = [];
let dirHandle: FileSystemDirectoryHandle | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number(n) || lo)));

function toBridgeMessage(m: Message): BridgeMessage {
    const channel = ChannelStore.getChannel(m.channel_id);
    const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    return {
        id: m.id,
        author: (m.author as any)?.globalName ?? m.author?.username ?? "",
        text: m.content ?? "",
        ts: new Date(m.timestamp as any).getTime(),
        channelId: m.channel_id,
        channelName: channel?.name ?? "",
        guildName: guild?.name ?? "",
        guildId: channel?.guild_id ?? undefined
    };
}

function keepNewest(list: BridgeMessage[], item: BridgeMessage) {
    if (list.some(x => x.id === item.id)) return;
    list.unshift(item);
    list.length = Math.min(list.length, clamp(settings.store.keep, 1, 200));
}

function channelCatchUp() {
    const ids = settings.store.channelIds.split(/[\s,]+/).filter(s => /^\d+$/.test(s)).slice(0, 20);
    const per = clamp(settings.store.perChannel, 1, 100);
    return ids.map(channelId => {
        const channel = ChannelStore.getChannel(channelId);
        const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
        const messages = (MessageStore.getMessages(channelId)?.toArray?.() ?? []).slice(-per).map(toBridgeMessage);
        return { channelId, name: channel?.name ?? "", guildName: guild?.name ?? "", messages };
    });
}

async function writeFile(text: string) {
    // Desktop: native.ts. Web: the folder handle the owner granted.
    const native = (globalThis as any).VencordNative?.pluginHelpers?.VexBridge;
    if (native?.write) {
        await native.write(text);
        return;
    }
    if (!dirHandle) throw new Error("no folder chosen yet (plugin settings: Choose the folder)");
    const perm = await (dirHandle as any).queryPermission({ mode: "readwrite" });
    if (perm !== "granted") throw new Error("the folder needs permission again (press Choose the folder)");
    const handle = await dirHandle.getFileHandle(FILE, { create: true });
    const stream = await handle.createWritable(); // written to a swap file and swapped in on close: never half a file
    await stream.write(text);
    await stream.close();
}

async function flush() {
    timer = null;
    const me = UserStore.getCurrentUser();
    const doc = buildBridge({
        accountName: (me as any)?.globalName ?? me?.username ?? "",
        now: Date.now(),
        mentions, replies,
        channels: channelCatchUp()
    });
    try {
        await writeFile(serialise(doc));
    } catch (e) {
        logger.warn("not written:", e);
    }
}

// A burst of messages is one write, a few seconds after the last one.
function scheduleWrite() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 4000);
}

export default definePlugin({
    name: "VexBridge",
    description: "Writes your mentions, replies and a channel catch-up to vex-bridge.json for the Vex browser (read-only; nothing is sent or changed in Discord)",
    authors: [Devs.Ven], // replace with the owner's registered entry when it is added to constants
    settings,

    settingsAboutComponent: () => "Choose the same folder in Vex (Settings, Community and chat tools, Vencord bridge).",

    // The folder picker needs a click; the settings page calls this from a button.
    async chooseFolder() {
        const picker = (globalThis as any).showDirectoryPicker;
        if (!picker) throw new Error("this client has no folder picker; use Vencord Desktop with the native helper");
        dirHandle = await picker({ mode: "readwrite", id: "vex-bridge" });
        scheduleWrite();
    },

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: Message; optimistic: boolean; }) {
            if (optimistic || !message?.content) return;
            const me = UserStore.getCurrentUser();
            if (!me || message.author?.id === me.id) return;
            const channel = ChannelStore.getChannel(message.channel_id);
            if (!channel) return;
            if (!channel.guild_id && !settings.store.includeDms) return;

            const mentioned = message.mentions?.some((u: any) => u.id === me.id) || message.mention_everyone;
            const replyToMe = (message as any).referenced_message?.author?.id === me.id;
            if (replyToMe) keepNewest(replies, toBridgeMessage(message));
            else if (mentioned) keepNewest(mentions, toBridgeMessage(message));
            else return;
            scheduleWrite();
        }
    },

    start() {
        scheduleWrite();
    },

    stop() {
        if (timer) clearTimeout(timer);
        timer = null;
        dirHandle = null;
        mentions.length = 0;
        replies.length = 0;
    }
});

// FluxDispatcher is imported so a build that tree-shakes `flux:` handlers still resolves the dispatcher.
void FluxDispatcher;
