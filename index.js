import 'dotenv/config';
import {
    Client, GatewayIntentBits, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, Events
} from 'discord.js';
import {
    joinVoiceChannel, createAudioPlayer, createAudioResource,
    AudioPlayerStatus, StreamType,
} from '@discordjs/voice';
import {
    Ytdl, chooseFormat, Quality, SearchType, parseVideoId,
} from '@distube/ytdl-core';
import { SyncLyrics } from '@stef-0012/synclyrics';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ========== KONFIGURASI EMOJI UNGU ==========
const EMOJI = {
    // ===== BUTTON =====
    DOWN:         '<:1000335978:1567371812587704392>',
    BACK:         '<:1000335979:1567371810620706896>',
    PAUSE:        '<:1000335980:1567371815389630484>', // ✅ FIX: ID disesuaikan dengan screenshot (0484)
    PLAY:         '<:1000335981:1567371817490845716>',
    SKIP:         '<:1000335982:1567371819558772766>',
    UP:           '<:1000335983:1567371822410895360>',
    SHUFFLE:      '<:1000335984:1567371824696664154>',
    LOOP:         '<:1000335985:1567371827284811786>',
    STOP:         '<:1000335986:1567371830157910158>',
    AUTOPLAY:     '<:1000335987:1567371833282658414>',
    PLAYLIST:     '<:1000335988:1567371835916681226>',
    ALWAYS:       '<:1000335989:1567371838269558915>',

    // ===== EMBED =====
    NOW_PLAYING:  '<:1000335991:1567371842690224198>',
    PLAYING:      '<:1000335990:1567371840454926356>',
    UP_NEXT:      '<:1000335992:1567371844934176800>',
    TOTAL:        '<:1000335993:1567371847262011443>',
    REQUESTED_BY: '<:1000335994:1567371849413955725>',
    DURATION:     '<:1000335995:1567371851888463903>',
    ARTIST:       '<:1000335996:1567371854329413783>',
    QUEUE_TITLE:  '<:1000335997:1567371856602996828>', 
    LOADING:      '<:1000335999:1567371861078048884>',
    LYRICS:       '<:1000336000:1567371863536181358>',

    // ===== RESPON =====
    SUCCESS:      '<:1000336001:1567371866103087154>',
    ERROR:        '<:1000336002:1567371869034774528>',
    STOPPED:      '<:1000336003:1567371871551492216>',
};

// ===== VALIDASI EMOJI ID =====
let invalidEmojiCount = 0;
for (const [key, val] of Object.entries(EMOJI)) {
    const m = val.match(/^<a?:[^:]+:(\d+)>$/);
    if (!m) {
        console.warn(`[EMOJI] ${key}: format salah → ${val}`);
        invalidEmojiCount++;
        continue;
    }
    const len = m[1].length;
    if (len < 17 || len > 19) {
        console.warn(`[EMOJI] ${key}: ID ${len} digit (harus 17-19) → ${val}`);
        invalidEmojiCount++;
    }
}
if (invalidEmojiCount > 0) {
    console.warn(`[WARNING] Ada ${invalidEmojiCount} emoji yang formatnya salah! Panel Discord bisa gagal dikirim.`);
} else {
    console.log('[EMOJI] Format ID valid.');
}

const EMBED_COLOR = 0x3498db;
const INACTIVITY_MS = 120_000;
const ALONE_TIMEOUT_MS = 300_000;
const PLAYLIST_LIMIT = 50;

// ===== CETAK VERSI LIBRARY =====
try {
    const pkg = require('@distube/ytdl-core/package.json');
    console.log(`[YTDL] Versi terpasang: ${pkg.version}`);
} catch (e) {
    console.warn('[YTDL] Tidak bisa baca package.json:', e.message);
}

// ===== INISIALISASI YTDL v5 =====
let yt;
try {
    if (fs.existsSync('cookies.json')) {
        const arr = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));
        const cookieStr = arr.map(c => `${c.name}=${c.value}`).join('; ');
        yt = new Ytdl({ cookie: cookieStr });
        console.log('[YTDL] Cookies loaded.');
    } else {
        yt = new Ytdl();
        console.log('[YTDL] Tanpa cookies.');
    }
} catch (e) {
    console.warn('[YTDL] Gagal load cookies:', e.message);
    yt = new Ytdl();
}

const lyricsManager = new SyncLyrics({
    sources: ['musixmatch', 'lrclib', 'netease'],
    logLevel: 'none'
});

// ========== UTIL ==========
function formatDuration(seconds) {
    if (!seconds) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0
        ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function cleanTitle(text) {
    if (!text) return '';
    text = text.replace(/[\(\ \[\{].*?[\)\]\}]/g, '');
    const junk = ['official video', 'official music video', 'lyrics', 'audio', 'mv', 'm/v',
        'music video', 'official audio', 'hd', 'hq', 'visualizer', 'ft.', 'feat.'];
    junk.forEach(w => text = text.replace(new RegExp(`\\b${w}\\b`, 'gi'), ''));
    return text.trim();
}

function pickString(...candidates) {
    for (const c of candidates) {
        if (c === null || c === undefined) continue;
        if (typeof c === 'string') {
            const s = c.trim();
            if (s) return s;
            continue;
        }
        if (typeof c === 'object') {
            const t = c.text ?? c.simpleText ?? c.content ?? c.value ?? c.name;
            if (typeof t === 'string' && t.trim()) return t.trim();
        }
    }
    return null;
}

function pickThumbnail(...sources) {
    for (const src of sources) {
        if (!src) continue;
        if (typeof src === 'string') return src;
        if (Array.isArray(src) && src.length) {
            const first = src[0];
            if (typeof first === 'string') return first;
            if (first?.url) return first.url;
        }
        if (src?.url) return src.url;
        if (Array.isArray(src?.thumbnails) && src.thumbnails.length) {
            const t = src.thumbnails[0];
            return typeof t === 'string' ? t : t?.url;
        }
    }
    return null;
}

async function fetchOEmbed(videoUrl) {
    try {
        const res = await fetch(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`
        );
        if (!res.ok) return null;
        const json = await res.json();
        return {
            title: json.title,
            author: json.author_name,
            thumbnail: json.thumbnail_url,
        };
    } catch (e) {
        console.warn('[oEmbed] gagal:', e.message);
        return null;
    }
}

function dumpInfoStructure(info, label = '') {
    try {
        const summary = {
            topLevelKeys: Object.keys(info),
            basicInfoTitle: info.basicInfo?.title,
            videoDetailsTitle: info.videoDetails?.title,
            videoDetailsTitleType: typeof info.videoDetails?.title,
            videoDetailsUrl: info.videoDetails?.url,
            videoDetailsAuthorName: info.videoDetails?.author?.name,
            microformatTitle: info.microformat?.title
                || info.microformat?.playerMicroformatRenderer?.title,
            playerResponseTitle: info.playerResponse?.videoDetails?.title,
        };
        console.log(`\n========== [INFO DUMP ${label}] ==========`);
        console.log(JSON.stringify(summary, null, 2));
        console.log('==========================================\n');
    } catch (e) {
        console.warn('[INFO DUMP] gagal:', e.message);
    }
}

async function fetchLyrics(title, artist) {
    const ct = cleanTitle(title);
    const ca = cleanTitle(artist);
    const queries = [];
    if (ca && !['youtube', 'unknown artist', 'various artists', 'topic'].includes(ca.toLowerCase())) {
        queries.push({ track: ct, artist: ca });
    }
    queries.push({ track: ct });
    queries.push({ track: title });

    for (const q of queries) {
        try {
            const data = await lyricsManager.getLyrics(q);
            if (data?.lyrics) return data.lyrics;
        } catch (_) {}
    }
    return null;
}

function formatLyricsEmbed(lrc, track) {
    const plain = lrc.split('\n')
        .map(l => l.includes(']') ? l.split(']').pop().trim() : l.trim())
        .filter(Boolean)
        .join('\n')
        .slice(0, 4000);
    return new EmbedBuilder()
        .setTitle(`${EMOJI.LYRICS} Lirik: ${track.title}`)
        .setDescription(plain || '*Lirik tidak tersedia.*')
        .setColor(EMBED_COLOR);
}

// ========== CLASS TRACK ==========
class Track {
    constructor(data, requester) {
        this.title = data.title || 'Unknown Title';
        this.artist = data.artist || 'Unknown Artist';
        this.url = data.url;
        this.webpage_url = data.webpage_url;
        this.video_id = data.video_id;
        this.duration = data.duration || 0;
        this.thumbnail = data.thumbnail;
        this.requester = requester;
        this.info = data.info;
        this.format = data.format;
    }

    static isPlaylistUrl(query) {
        return /[?&]list=/.test(query) || /^(PL|UU|OL|LL|FL|RD)[\w-]{10,}$/.test(query);
    }

    static async fromVideoUrl(videoUrl, requester, fallbackData = {}) {
        const info = await yt.getInfo(videoUrl);
        dumpInfoStructure(info, videoUrl);

        const b  = info.basicInfo || {};
        const v  = info.videoDetails || {};
        const m  = info.microformat?.playerMicroformatRenderer || info.microformat || {};
        const pr = info.playerResponse?.videoDetails
                || info.player_response?.videoDetails
                || info.player_response?.player_response?.videoDetails
                || info.player_response?.videoDetails
                || {};

        let title = pickString(
            fallbackData.title,
            b.title, v.title, pr.title, m.title, info.title,
        );

        let artist = pickString(
            fallbackData.artist,
            v.author?.name, b.author?.name, v.author, b.author, pr.author,
            m.ownerChannelName, v.ownerChannelName, b.ownerChannelName,
            b.channelTitle, v.channelTitle,
        );

        const videoId = pickString(b.id, v.videoId, pr.videoId, m.videoId)
                     || parseVideoId(videoUrl) || '';

        let duration = Number(b.lengthSeconds ?? v.lengthSeconds ?? pr.lengthSeconds ?? 0)
                     || fallbackData.duration || 0;

        let thumbnail = pickThumbnail(
            b.thumbnail, v.thumbnail, v.thumbnails, pr.thumbnail, m.thumbnail,
            fallbackData.thumbnail,
        );

        if (!title) {
            const oe = await fetchOEmbed(videoUrl);
            if (oe) {
                title = oe.title;
                artist = artist || oe.author;
                thumbnail = thumbnail || oe.thumbnail;
            }
        }

        title = title || `Unknown Title (${videoId || 'no-id'})`;
        artist = artist || 'Unknown Artist';

        const format = chooseFormat(info.formats, {
            quality: Quality.HighestAudio,
            filter: { hasAudio: true, hasVideo: false },
        });
        if (!format) throw new Error('Format audio tidak tersedia.');

        const webpage = v.url || `https://www.youtube.com/watch?v=${videoId}`;

        return new Track({
            title, artist,
            url: format.url,
            webpage_url: webpage,
            video_id: videoId,
            duration, thumbnail, info, format,
        }, requester);
    }

    static async fromQuery(query, requester) {
        let videoUrl = null;
        let summary = null;
        const parsedId = parseVideoId(query);

        if (parsedId) {
            videoUrl = `https://www.youtube.com/watch?v=${parsedId}`;
        } else {
            const results = await yt.search(query, { limit: 1, type: SearchType.Video });
            if (!results.length) throw new Error('Tidak ada hasil ditemukan.');
            summary = results[0];
            videoUrl = summary.url || `https://www.youtube.com/watch?v=${summary.id}`;
            console.log(`[SEARCH] "${query}" → "${summary.title}" (${videoUrl})`);
        }

        return Track.fromVideoUrl(videoUrl, requester, {
            title: summary?.title,
            artist: summary?.author?.name,
            duration: summary?.duration ? Math.floor(summary.duration / 1000) : 0,
            thumbnail: pickThumbnail(summary?.thumbnail),
        });
    }
}

// ========== PLAYER ==========
const players = new Map();

class MusicPlayer {
    constructor(guildId, voiceChannel, textChannel) {
        this.guildId = guildId;
        this.voiceChannel = voiceChannel;
        this.textChannel = textChannel;
        this.queue = [];
        this.history = [];
        this.current = null;
        this.volume = 0.5;
        this.message = null;
        this.startTime = 0;
        this.pauseTime = 0;
        this.loopMode = false;
        this.autoplayEnabled = false;
        this.autoplayLoading = false;
        this.always247 = false;
        this.destroyed = false;
        this.updateInterval = null;
        this.inactivityTimer = null;

        this.playlistLoading = {
            active: false,
            loaded: 0,
            total: 0,
            name: null,
        };

        this.connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf: true,
        });

        this.connection.on('stateChange', (_, newState) => {
            if (newState.status === 'disconnected') {
                this.destroyed = true;
                this.clearInactivityTimer();
                this.stopUpdate();
                players.delete(this.guildId);
            }
        });

        this.player = createAudioPlayer();
        this.connection.subscribe(this.player);

        this.player.on(AudioPlayerStatus.Idle, () => this.onIdle());
        this.player.on('error', err => {
            console.error('[Player Error]', err.message);
            this.onIdle(true);
        });
    }

    clearInactivityTimer() {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }
    }

    startInactivityTimer() {
        this.clearInactivityTimer();
        if (this.always247 || this.destroyed) return;

        this.inactivityTimer = setTimeout(async () => {
            if (this.destroyed) return;
            if (this.always247) return;
            if (this.current) return;
            if (this.player.state.status === AudioPlayerStatus.Playing) return;

            console.log(`[Inactivity] Auto-disconnect dari guild ${this.guildId}`);
            await this.deletePanel();
            this.destroy();
            players.delete(this.guildId);
        }, INACTIVITY_MS);
    }

    async loadPlaylistProgressively(playlist, requester) {
        const videos = playlist.videos || [];
        if (!videos.length) throw new Error('Playlist kosong.');

        const playlistName = playlist.title || playlist.info?.title || 'Playlist';

        let firstTrack = null;
        let startIdx = 0;
        for (let i = 0; i < videos.length; i++) {
            if (this.destroyed) throw new Error('Player sudah berhenti.');
            const v = videos[i];
            try {
                firstTrack = await Track.fromVideoUrl(
                    v.url || `https://www.youtube.com/watch?v=${v.id}`,
                    requester,
                    {
                        title: v.title,
                        artist: v.author?.name,
                        duration: v.lengthSeconds,
                        thumbnail: v.thumbnails?.[0]?.url,
                    }
                );
                startIdx = i + 1;
                console.log(`[Playlist] First track ready: "${firstTrack.title}" (index ${i})`);
                break;
            } catch (e) {
                console.warn(`[Playlist] skip ${v.id}:`, e.message);
            }
        }
        if (!firstTrack) throw new Error('Tidak ada video yang dapat diputar dari playlist ini.');

        this.addToQueue([firstTrack]);
        if (this.player.state.status !== AudioPlayerStatus.Playing && !this.current) {
            this.playNext();
        }

        const remaining = videos.length - startIdx;
        this.playlistLoading = {
            active: remaining > 0,
            loaded: startIdx,
            total: videos.length,
            name: playlistName,
        };

        if (remaining > 0) {
            (async () => {
                let added = 0;
                for (let i = startIdx; i < videos.length; i++) {
                    if (this.destroyed) {
                        this.playlistLoading.active = false;
                        return;
                    }
                    const v = videos[i];
                    try {
                        const t = await Track.fromVideoUrl(
                            v.url || `https://www.youtube.com/watch?v=${v.id}`,
                            requester,
                            {
                                title: v.title,
                                artist: v.author?.name,
                                duration: v.lengthSeconds,
                                thumbnail: v.thumbnails?.[0]?.url,
                            }
                        );
                        this.addToQueue([t]);
                        added++;
                        this.playlistLoading.loaded = startIdx + added;
                    } catch (e) {
                        console.warn(`[Playlist BG] skip ${v.id}:`, e.message);
                        this.playlistLoading.loaded = startIdx + added + 1;
                    }
                }
                this.playlistLoading.active = false;
                console.log(`[Playlist BG] Done: +${added}/${remaining} tracks added to queue`);
            })().catch(e => {
                console.error('[Playlist BG] Fatal:', e);
                this.playlistLoading.active = false;
            });
        }

        return { firstTrack, remaining, total: videos.length, playlistName };
    }

    async fetchAutoplayTrack() {
        if (!this.current) return null;
        const vid = this.current.video_id;

        if (this.current.info?.relatedVideos?.length) {
            const related = this.current.info.relatedVideos.filter(v => v.id !== vid);
            if (related.length) {
                const pick = related[Math.floor(Math.random() * related.length)];
                return await Track.fromQuery(pick.url, this.current.requester);
            }
        }

        const artist = (this.current.artist || '').trim();
        if (artist && !['youtube', 'unknown artist', 'various artists', 'topic'].includes(artist.toLowerCase())) {
            try {
                const results = await yt.search(`${artist} songs`, { limit: 5, type: SearchType.Video });
                for (const r of results) {
                    if (r.id === vid) continue;
                    return await Track.fromQuery(r.url, this.current.requester);
                }
            } catch (e) { console.warn('[Autoplay] artist:', e.message); }
        }

        try {
            const title = cleanTitle(this.current.title);
            if (title && !title.startsWith('Unknown Title')) {
                const results = await yt.search(`${title} similar songs`, { limit: 5, type: SearchType.Video });
                for (const r of results) {
                    if (r.id === vid) continue;
                    return await Track.fromQuery(r.url, this.current.requester);
                }
            }
        } catch (e) { console.warn('[Autoplay] title:', e.message); }

        return null;
    }

    async autoplayNext() {
        this.autoplayLoading = true;
        if (this.message) {
            const loading = new EmbedBuilder()
                .setTitle(`${EMOJI.AUTOPLAY} AutoPlay`)
                .setDescription('Mencari lagu berikutnya…')
                .setColor(EMBED_COLOR);
            if (this.current) {
                loading.setAuthor({
                    name: `Music Panel • ${this.current.requester.displayName}`,
                    iconURL: this.current.requester.displayAvatarURL()
                });
            }
            await this.message.edit({ embeds: [loading], components: this.buildControls() }).catch(() => {});
        }

        let next = null;
        try {
            next = await Promise.race([
                this.fetchAutoplayTrack(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 25000))
            ]);
        } catch (e) { console.warn('[Autoplay]', e.message); }

        this.autoplayLoading = false;

        if (next) {
            this.queue.push(next);
            this.current = null;
            this.playNext();
        } else {
            this.current = null;
            this.startTime = 0;
            this.stopUpdate();
            await this.deletePanel();
            this.startInactivityTimer();
        }
    }

    onIdle(isError = false) {
        if (this.destroyed) return;

        if (this.loopMode && this.current) this.queue.unshift(this.current);

        if (!this.queue.length) {
            if (this.autoplayEnabled && this.current && !this.autoplayLoading) {
                this.autoplayLoading = true;
                this.autoplayNext().catch(e => console.error('[Autoplay Next]', e));
                return;
            }
            this.current = null;
            this.startTime = 0;
            this.stopUpdate();
            this.deletePanel().catch(() => {});
            this.startInactivityTimer();
            return;
        }

        if (this.current && !isError) this.history.push(this.current);
        this.current = this.queue.shift();
        this.startTime = Date.now();
        this.pauseTime = 0;
        this.playCurrent();
    }

    async playCurrent() {
        if (!this.current || this.destroyed) return;
        this.clearInactivityTimer();
        try {
            const stream = yt.download(this.current.info, { format: this.current.format });
            const resource = createAudioResource(stream, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true,
            });
            resource.volume.setVolume(this.volume);

            this.player.play(resource);
            this.startUpdate();
            await this.sendNowPlaying();
        } catch (e) {
            console.error('[PlayCurrent]', e);
            this.onIdle(true);
        }
    }

    playNext() { this.onIdle(false); }
    addToQueue(tracks) { this.queue.push(...tracks); }

    buildNowPlayingEmbed() {
        const isPaused = this.player.state.status === AudioPlayerStatus.Paused;
        const elapsed = isPaused ? this.pauseTime : Date.now() - this.startTime;
        const cur = Math.floor(elapsed / 1000);
        const total = this.current.duration;

        const embed = new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setAuthor({
                name: `Music Panel • ${this.current.requester.displayName}`,
                iconURL: this.current.requester.displayAvatarURL()
            })
            .setDescription(`**[${this.current.title}](${this.current.webpage_url})**\n\n`)
            .addFields(
                { name: `${EMOJI.REQUESTED_BY} Requested By`, value: `<@${this.current.requester.id}>`, inline: false },
                { name: `${EMOJI.DURATION} Music Duration`, value: `\`${formatDuration(cur)} / ${formatDuration(total)}\``, inline: false },
                { name: `${EMOJI.ARTIST} Music Author`, value: `\`${this.current.artist}\``, inline: false }
            );

        if (this.playlistLoading.active) {
            embed.addFields({
                name: `${EMOJI.LOADING} Loading Playlist`,
                value: `**${this.playlistLoading.name}** — \`${this.playlistLoading.loaded}/${this.playlistLoading.total}\` lagu di-load\n` +
                       `\`${this.queue.length}\` lagu sudah siap di queue`,
                inline: false
            });
        } else if (this.queue.length > 0) {
            embed.addFields({
                name: `${EMOJI.UP_NEXT} Up Next`,
                value: `\`${this.queue.length}\` lagu dalam antrean`,
                inline: false
            });
        }

        return embed;
    }

    buildQueueEmbed() {
        const totalDuration = this.queue.reduce((sum, t) => sum + (t.duration || 0), 0);

        let header = '';
        if (this.current) {
            header += `**${EMOJI.NOW_PLAYING} Now Playing**\n`;
            header += `[${this.current.title}](${this.current.webpage_url}) — \`${formatDuration(this.current.duration)}\`\n\n`;
        }

        if (this.playlistLoading.active) {
            header += `${EMOJI.LOADING} **Loading playlist:** \`${this.playlistLoading.name}\` (\`${this.playlistLoading.loaded}/${this.playlistLoading.total}\`)\n\n`;
        }

        if (!this.queue.length) {
            return new EmbedBuilder()
                .setColor(EMBED_COLOR)
                .setTitle(`${EMOJI.QUEUE_TITLE} Queue`)
                .setDescription(header + '*Antrean kosong.*');
        }

        const MAX_DESC_LEN = 3900;
        const lines = [];

        for (let i = 0; i < this.queue.length; i++) {
            const t = this.queue[i];
            let title = (t.title || 'Unknown').trim();
            if (title.length > 70) title = title.slice(0, 67) + '...';

            const num = String(i + 1).padStart(2, ' ');
            lines.push(`\`${num}.\` ${title} — \`${formatDuration(t.duration)}\``);
        }

        const summary = `\n\n**${EMOJI.TOTAL} Total:** \`${this.queue.length}\` lagu • \`${formatDuration(totalDuration)}\``;

        let queueText = '';
        let shown = 0;
        const maxQueueLen = MAX_DESC_LEN - header.length - summary.length - 200;

        for (let i = 0; i < lines.length; i++) {
            const line = (i === lines.length - 1 ? lines[i] : lines[i] + '\n');
            if (queueText.length + line.length > maxQueueLen) {
                const remaining = lines.length - i;
                queueText += `\n*...dan ${remaining} lagu lainnya*`;
                break;
            }
            queueText += line;
            shown = i + 1;
        }

        const embed = new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle(`${EMOJI.QUEUE_TITLE} Queue`)
            .setDescription(header + queueText + summary);

        if (shown < this.queue.length) {
            embed.setFooter({ text: `Menampilkan ${shown}/${this.queue.length} lagu (batas Discord)` });
        } else if (this.playlistLoading.active) {
            embed.setFooter({ text: `${EMOJI.LOADING} Masih loading lagu dari playlist...` });
        }

        return embed;
    }

    buildControls() {
        const isPaused = this.player.state.status === AudioPlayerStatus.Paused;

        const r0 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vol_down').setEmoji(EMOJI.DOWN).setLabel('Vol -').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('previous').setEmoji(EMOJI.BACK).setLabel('Previous').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('play_pause')
                .setEmoji(isPaused ? EMOJI.PLAY : EMOJI.PAUSE)
                .setLabel(isPaused ? 'Resume' : 'Pause')
                .setStyle(ButtonStyle.Primary),
        );
        const r1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('skip').setEmoji(EMOJI.SKIP).setLabel('Skip').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('vol_up').setEmoji(EMOJI.UP).setLabel('Vol +').setStyle(ButtonStyle.Secondary),
        );
        const r2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('shuffle').setEmoji(EMOJI.SHUFFLE).setLabel('Shuffle').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('loop').setEmoji(EMOJI.LOOP).setLabel(`Loop: ${this.loopMode ? 'ON' : 'OFF'}`).setStyle(this.loopMode ? ButtonStyle.Success : ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('stop').setEmoji(EMOJI.STOP).setLabel('Stop').setStyle(ButtonStyle.Danger),
        );
        const r3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('autoplay').setEmoji(EMOJI.AUTOPLAY).setLabel(`Autoplay: ${this.autoplayEnabled ? 'ON' : 'OFF'}`).setStyle(this.autoplayEnabled ? ButtonStyle.Success : ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('247').setEmoji(EMOJI.ALWAYS).setLabel(`24/7: ${this.always247 ? 'ON' : 'OFF'}`).setStyle(this.always247 ? ButtonStyle.Success : ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('queue').setEmoji(EMOJI.PLAYLIST).setLabel('Queue').setStyle(ButtonStyle.Primary),
        );
        return [r0, r1, r2, r3];
    }

    async sendNowPlaying() {
        if (!this.current) return;
        const embed = this.buildNowPlayingEmbed();
        const comps = this.buildControls();

        if (this.message) {
            try {
                await this.message.edit({ embeds: [embed], components: comps });
            } catch (err) {
                console.error('[Panel Edit Error]', err.message);
            }
        } else {
            try {
                this.message = await this.textChannel.send({ embeds: [embed], components: comps });
            } catch (err) {
                console.error('[Panel Send Error]', err.message);
                this.message = null;
            }
        }
    }

    startUpdate() {
        this.stopUpdate();
        this.updateInterval = setInterval(async () => {
            if (this.destroyed) return;
            if (this.current && this.message && this.player.state.status === AudioPlayerStatus.Playing) {
                const embed = this.buildNowPlayingEmbed();
                try {
                    await this.message.edit({ embeds: [embed], components: this.buildControls() });
                } catch (err) {
                    console.error('[Panel Update Error]', err.message);
                    this.stopUpdate();
                }
            }
        }, 1000);
    }

    stopUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    async deletePanel() {
        if (!this.message) return;
        const msg = this.message;
        this.message = null;
        try {
            await msg.delete();
        } catch (_) {}
    }

    destroy() {
        this.destroyed = true;
        this.clearInactivityTimer();
        this.stopUpdate();
        this.queue = [];
        this.current = null;
        this.playlistLoading.active = false;
        this.deletePanel().catch(() => {});
        try { this.player.stop(true); } catch (_) {}
        try { this.connection.destroy(); } catch (_) {}
    }
}

// ========== BOT CLIENT ==========
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once(Events.ClientReady, async () => {
    console.log(`Login sebagai ${client.user.tag}`);

    const commands = [
        { name: 'play', description: 'Putar lagu dari YouTube (mendukung URL playlist)',
          options: [{ name: 'query', description: 'Judul lagu, Link video, atau Link playlist', type: 3, required: true }] },
        { name: 'lyrics', description: 'Cari lirik untuk lagu yang sedang diputar' },
        { name: 'volume', description: 'Atur volume (0-200)',
          options: [{ name: 'level', description: 'Level volume 0-200', type: 4, required: true }] },
        { name: 'queue', description: 'Lihat antrean lagu (semua)' },
        { name: 'stop', description: 'Hentikan musik dan keluarkan bot' },
        { name: '247', description: 'Aktifkan/matikan mode 24/7 (bot stay di voice)' },
    ];
    await client.application.commands.set(commands);
});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;

            if (commandName === 'play') {
                await interaction.deferReply({ ephemeral: true });
                const query = interaction.options.getString('query');
                const vc = interaction.member.voice.channel;
                if (!vc) return interaction.followUp({ content: 'Kamu harus berada di voice channel.', ephemeral: true });

                let player = players.get(interaction.guildId);
                if (!player) {
                    player = new MusicPlayer(interaction.guildId, vc, interaction.channel);
                    players.set(interaction.guildId, player);
                } else {
                    player.clearInactivityTimer();
                    player.textChannel = interaction.channel;
                }

                if (Track.isPlaylistUrl(query)) {
                    try {
                        console.log(`[Playlist] Fetching metadata: ${query}`);
                        const playlist = await yt.getPlaylist(query, { limit: PLAYLIST_LIMIT });
                        if (!playlist?.videos?.length) {
                            throw new Error('Playlist kosong atau tidak dapat diakses.');
                        }

                        const { firstTrack, remaining, total, playlistName } =
                            await player.loadPlaylistProgressively(playlist, interaction.user);

                        await interaction.followUp({
                            content: `${EMOJI.PLAYING} **${playlistName}** (${total} lagu)\n` +
                                     `${EMOJI.PLAYING} Memutar: \`${firstTrack.title}\` \`[${formatDuration(firstTrack.duration)}]\`\n` +
                                     (remaining > 0
                                        ? `${EMOJI.LOADING} Loading **${remaining}** lagu berikutnya di background...\nKlik tombol **${EMOJI.PLAYLIST} Queue** untuk lihat semua.`
                                        : `${EMOJI.SUCCESS} Semua lagu sudah di-queue.`),
                            ephemeral: true
                        });
                    } catch (e) {
                        console.error('[Playlist]', e);
                        await interaction.followUp({ content: `Gagal memuat playlist: ${e.message}`, ephemeral: true });
                    }
                    return;
                }

                try {
                    const track = await Track.fromQuery(query, interaction.user);
                    player.addToQueue([track]);

                    await interaction.followUp({
                        content: `${EMOJI.SUCCESS} **Added to Queue**\n\`${track.title}\` \`[${formatDuration(track.duration)}]\``,
                        ephemeral: true
                    });

                    if (player.player.state.status !== AudioPlayerStatus.Playing && !player.current) {
                        player.playNext();
                    } else if (player.message && player.current) {
                        await player.message.edit({
                            embeds: [player.buildNowPlayingEmbed()],
                            components: player.buildControls()
                        }).catch(() => {});
                    }
                } catch (e) {
                    console.error(e);
                    await interaction.followUp({ content: `Gagal memuat: ${e.message}`, ephemeral: true });
                }
                return;
            }

            if (commandName === 'lyrics') {
                await interaction.deferReply({ ephemeral: true });
                const player = players.get(interaction.guildId);
                if (!player?.current) return interaction.followUp({ content: 'Tidak ada lagu yang diputar.', ephemeral: true });

                const lrc = await fetchLyrics(player.current.title, player.current.artist);
                if (!lrc) return interaction.followUp({ content: `${EMOJI.ERROR} Lirik untuk **${player.current.title}** tidak ditemukan.`, ephemeral: true });

                await interaction.followUp({ embeds: [formatLyricsEmbed(lrc, player.current)], ephemeral: true });
                return;
            }

            if (commandName === 'volume') {
                await interaction.deferReply({ ephemeral: true });
                const level = interaction.options.getInteger('level');
                if (level < 0 || level > 200) return interaction.followUp({ content: 'Volume harus antara 0 dan 200.', ephemeral: true });

                const player = players.get(interaction.guildId);
                if (!player) return interaction.followUp({ content: 'Tidak ada pemutar aktif.', ephemeral: true });

                player.volume = level / 100;
                const res = player.player.state.resource;
                if (res?.volume) res.volume.setVolume(player.volume);
                await interaction.followUp({ content: `${EMOJI.UP} Volume diatur ke ${level}%.`, ephemeral: true });
                return;
            }

            if (commandName === 'queue') {
                await interaction.deferReply({ ephemeral: true });
                const player = players.get(interaction.guildId);
                if (!player || (!player.queue.length && !player.current)) {
                    return interaction.followUp({ content: 'Antrean kosong.', ephemeral: true });
                }
                await interaction.followUp({ embeds: [player.buildQueueEmbed()], ephemeral: true });
                return;
            }

            if (commandName === 'stop') {
                await interaction.deferReply({ ephemeral: true });
                const player = players.get(interaction.guildId);
                if (player) {
                    await player.deletePanel();
                    player.destroy();
                    players.delete(interaction.guildId);
                    await interaction.followUp({ content: `${EMOJI.STOPPED} Dihentikan dan keluar dari voice.`, ephemeral: true });
                } else {
                    await interaction.followUp({ content: 'Tidak ada yang bisa dihentikan.', ephemeral: true });
                }
                return;
            }

            if (commandName === '247') {
                await interaction.deferReply({ ephemeral: true });
                const player = players.get(interaction.guildId);
                if (!player) return interaction.followUp({ content: 'Tidak ada pemutar aktif. Gunakan `/play` dulu.', ephemeral: true });

                player.always247 = !player.always247;
                if (player.always247) {
                    player.clearInactivityTimer();
                } else if (!player.current) {
                    player.startInactivityTimer();
                }

                if (player.message && player.current) {
                    await player.message.edit({
                        embeds: [player.buildNowPlayingEmbed()],
                        components: player.buildControls()
                    }).catch(() => {});
                }

                await interaction.followUp({
                    content: `${EMOJI.ALWAYS} Mode 24/7: **${player.always247 ? 'ON' : 'OFF'}**`,
                    ephemeral: true
                });
                return;
            }
        }

        if (interaction.isButton()) {
            const player = players.get(interaction.guildId);
            if (!player || player.destroyed) {
                return interaction.reply({ content: 'Tidak ada pemutar aktif.', ephemeral: true });
            }

            const id = interaction.customId;

            if (id === 'vol_down') {
                player.volume = Math.max(0, player.volume - 0.1);
                const res = player.player.state.resource;
                if (res?.volume) res.volume.setVolume(player.volume);
                await interaction.reply({ content: `${EMOJI.DOWN} Volume turun ke ${Math.round(player.volume * 100)}%`, ephemeral: true });
                return;
            }

            if (id === 'vol_up') {
                player.volume = Math.min(2, player.volume + 0.1);
                const res = player.player.state.resource;
                if (res?.volume) res.volume.setVolume(player.volume);
                await interaction.reply({ content: `${EMOJI.UP} Volume naik ke ${Math.round(player.volume * 100)}%`, ephemeral: true });
                return;
            }

            if (id === 'play_pause') {
                const st = player.player.state.status;

                if (st === AudioPlayerStatus.Playing) {
                    player.pauseTime = Date.now() - player.startTime;
                    player.player.pause();
                    await interaction.update({
                        embeds: [player.buildNowPlayingEmbed()],
                        components: player.buildControls(),
                    });
                    return;
                }

                if (st === AudioPlayerStatus.Paused) {
                    player.player.unpause();
                    player.startTime = Date.now() - player.pauseTime;
                    await interaction.update({
                        embeds: [player.buildNowPlayingEmbed()],
                        components: player.buildControls(),
                    });
                    return;
                }

                return interaction.reply({ content: 'Tidak ada musik yang sedang diputar.', ephemeral: true });
            }

            if (id === 'skip') {
                if (!player.current) return interaction.reply({ content: 'Tidak ada musik.', ephemeral: true });
                player.autoplayEnabled = false;
                player.player.stop();
                return interaction.reply({ content: `${EMOJI.SKIP} Lagu dilewati.`, ephemeral: true });
            }

            if (id === 'previous') {
                if (!player.history.length) return interaction.reply({ content: 'Tidak ada riwayat lagu.', ephemeral: true });
                if (player.current) player.queue.unshift(player.current);
                player.queue.unshift(player.history.pop());
                player.player.stop();
                return interaction.reply({ content: `${EMOJI.BACK} Kembali ke lagu sebelumnya.`, ephemeral: true });
            }

            if (id === 'shuffle') {
                if (player.queue.length > 1) {
                    for (let i = player.queue.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [player.queue[i], player.queue[j]] = [player.queue[j], player.queue[i]];
                    }
                    return interaction.reply({ content: `${EMOJI.SHUFFLE} Antrean diacak.`, ephemeral: true });
                }
                return interaction.reply({ content: 'Antrean terlalu pendek.', ephemeral: true });
            }

            if (id === 'loop') {
                player.loopMode = !player.loopMode;
                await interaction.update({
                    embeds: [player.current
                        ? player.buildNowPlayingEmbed()
                        : new EmbedBuilder().setColor(EMBED_COLOR).setTitle(`${EMOJI.STOPPED} Music Stopped`)],
                    components: player.buildControls(),
                }).catch(() => {});
                return interaction.followUp({ content: `${EMOJI.LOOP} Mode Loop: **${player.loopMode ? 'Aktif' : 'Mati'}**`, ephemeral: true });
            }

            if (id === 'stop') {
                await player.deletePanel();
                player.destroy();
                players.delete(interaction.guildId);
                return interaction.reply({ content: `${EMOJI.STOPPED} Dihentikan dan keluar dari voice.`, ephemeral: true });
            }

            if (id === 'autoplay') {
                player.autoplayEnabled = !player.autoplayEnabled;
                if (player.message && player.current) {
                    await interaction.update({
                        embeds: [player.buildNowPlayingEmbed()],
                        components: player.buildControls(),
                    }).catch(() => {});
                } else {
                    await interaction.deferUpdate().catch(() => {});
                }
                return interaction.followUp({ content: `${EMOJI.AUTOPLAY} AutoPlay: **${player.autoplayEnabled ? 'ON' : 'OFF'}**`, ephemeral: true });
            }

            if (id === '247') {
                player.always247 = !player.always247;
                if (player.always247) {
                    player.clearInactivityTimer();
                } else if (!player.current) {
                    player.startInactivityTimer();
                }
                if (player.message && player.current) {
                    await interaction.update({
                        embeds: [player.buildNowPlayingEmbed()],
                        components: player.buildControls(),
                    }).catch(() => {});
                } else {
                    await interaction.deferUpdate().catch(() => {});
                }
                return interaction.followUp({ content: `${EMOJI.ALWAYS} Mode 24/7: **${player.always247 ? 'ON' : 'OFF'}**`, ephemeral: true });
            }

            if (id === 'queue') {
                return interaction.reply({ embeds: [player.buildQueueEmbed()], ephemeral: true });
            }
        }
    } catch (err) {
        console.error('[Interaction Error]', err);
        if (!interaction.replied && !interaction.deferred) {
            interaction.reply({ content: 'Terjadi error.', ephemeral: true }).catch(() => {});
        }
    }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    if (!oldState.member || !client.user) return;
    if (oldState.member.id === client.user.id) return;

    for (const [gid, player] of players) {
        if (player.destroyed || player.always247) continue;
        const ch = player.voiceChannel;
        if (!ch) continue;

        if (ch.members.size === 1) {
            setTimeout(async () => {
                const currentPlayer = players.get(gid);
                if (!currentPlayer || currentPlayer.destroyed || currentPlayer.always247) return;
                if (ch.members.size === 1) {
                    console.log(`[Alone] Bot sendiri di VC, keluar dari guild ${gid}`);
                    await currentPlayer.deletePanel();
                    currentPlayer.destroy();
                    players.delete(gid);
                }
            }, ALONE_TIMEOUT_MS);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);