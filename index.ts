import { Client, GatewayIntentBits, Partials, Events, REST, Routes, SlashCommandBuilder, ChatInputCommandInteraction, User, MessageFlags } from 'discord.js';
import dayjs from 'dayjs';
import fs from 'fs';
import { config } from 'dotenv';

const FILENAME_LIST_PATH = './filenames.json';
const CLAIMS_PATH = './claims.json';
const CONFIG_PATH = './server-config.json';

/**
 * The number of days a claim lasts. Change this value to adjust the claim duration.
 */
export const CLAIM_DURATION_DAYS = 1;

interface Claim {
    filename: string;
    userId: string;
    expiresAt: string;
    notified: boolean;
}

interface ServerConfig {
    okChannelId?: string;
}

config();
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    partials: [Partials.Channel]
});

function loadFilenames(): string[] {
    if (!fs.existsSync(FILENAME_LIST_PATH)) {
        fs.writeFileSync(FILENAME_LIST_PATH, JSON.stringify(["file1.txt", "file2.txt", "file3.txt"]));
    }
    return JSON.parse(fs.readFileSync(FILENAME_LIST_PATH, 'utf8'));
}

function loadClaims(): Claim[] {
    if (!fs.existsSync(CLAIMS_PATH)) {
        fs.writeFileSync(CLAIMS_PATH, JSON.stringify([]));
    }
    return JSON.parse(fs.readFileSync(CLAIMS_PATH, 'utf8'));
}

function saveClaims(claims: Claim[]): void {
    fs.writeFileSync(CLAIMS_PATH, JSON.stringify(claims, null, 2));
}

function loadServerConfig(guildId: string): ServerConfig {
    if (!fs.existsSync(CONFIG_PATH)) {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify({}));
    }
    const allConfig: Record<string, ServerConfig> = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return allConfig[guildId] || {};
}

function saveServerConfig(guildId: string, config: ServerConfig): void {
    let allConfig: Record<string, ServerConfig> = {};
    if (fs.existsSync(CONFIG_PATH)) {
        allConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
    allConfig[guildId] = config;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(allConfig, null, 2));
}

async function notifyExpiredClaims(): Promise<void> {
    const claims = loadClaims();
    const now = dayjs();
    let changed = false;
    for (const claim of claims) {
        if (!claim.notified && now.isAfter(dayjs(claim.expiresAt))) {
            try {
                const user: User = await client.users.fetch(claim.userId);
                await user.send(`Your claim on \`${claim.filename}\` has expired.`);
            } catch (e) { /* ignore */ }
            claim.notified = true;
            changed = true;
        }
    }
    if (changed) saveClaims(claims);
}

client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user?.tag}`);
    setInterval(notifyExpiredClaims, 30 * 60 * 1000); // Check every half hour
});

function pluralizeDay(days: number): string {
    return days === 1 ? 'day' : 'days';
}

const commands = [
    new SlashCommandBuilder()
        .setName('claim')
        .setDescription(`Claim a filename for ${CLAIM_DURATION_DAYS} ${pluralizeDay(CLAIM_DURATION_DAYS)}`)
        .addStringOption(option =>
            option.setName('filename')
                .setDescription('The filename to claim')
                .setRequired(true)
                .setAutocomplete(true)),
    new SlashCommandBuilder()
        .setName('unclaim')
        .setDescription('Unclaim a filename you have claimed')
        .addStringOption(option =>
            option.setName('filename')
                .setDescription('The filename to unclaim')
                .setRequired(true)
                .setAutocomplete(true)),
    new SlashCommandBuilder()
        .setName('setokchannel')
        .setDescription('Set the #ok channel for claim notifications (admin only)')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to use for claim notifications')
                .setRequired(true)
                .addChannelTypes(0)), // 0 = GUILD_TEXT
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

async function registerCommands() {
    try {
        const appId = (await rest.get(Routes.user())) as any;
        await rest.put(
            Routes.applicationCommands(appId.id),
            { body: commands.map(cmd => cmd.toJSON()) },
        );
        console.log('Commands registered');
    } catch (error) {
        console.error(error);
    }
}

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
        if (interaction.commandName === 'claim') {
            const focused = interaction.options.getFocused();
            const filenames = loadFilenames();
            const claims = loadClaims();
            // Only show unclaimed filenames
            const claimed = new Set(claims.filter(c => !dayjs().isAfter(dayjs(c.expiresAt))).map(c => c.filename));
            const choices = filenames.filter(f => !claimed.has(f) && f.toLowerCase().includes(focused.toLowerCase()));
            await interaction.respond(
                choices.slice(0, 25).map(name => ({ name, value: name }))
            );
        } else if (interaction.commandName === 'unclaim') {
            const focused = interaction.options.getFocused();
            const claims = loadClaims();
            // Only show files claimed by this user and not expired
            const userClaims = claims.filter(c => c.userId === interaction.user.id && !dayjs().isAfter(dayjs(c.expiresAt)));
            const choices = userClaims
                .map(c => c.filename)
                .filter(f => f.toLowerCase().includes(focused.toLowerCase()));
            await interaction.respond(
                choices.slice(0, 25).map(name => ({ name, value: name }))
            );
        }
        return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'claim') {
        const filename = interaction.options.getString('filename');
        if (!filename) {
            await interaction.reply({ content: 'Filename not found.', flags: MessageFlags.Ephemeral });
            return;
        }
        const filenames = loadFilenames();
        if (!filenames.includes(filename)) {
            await interaction.reply({ content: 'Filename not found.', flags: MessageFlags.Ephemeral });
            return;
        }
        let claims = loadClaims();
        if (claims.some(c => c.filename === filename && !dayjs().isAfter(dayjs(c.expiresAt)))) {
            await interaction.reply({ content: 'This filename is already claimed.', flags: MessageFlags.Ephemeral });
            return;
        }
        const expiresAt = dayjs().add(CLAIM_DURATION_DAYS, 'day').toISOString();
        claims = claims.filter(c => !(c.filename === filename && dayjs().isAfter(dayjs(c.expiresAt))));
        claims.push({ filename: filename, userId: interaction.user.id, expiresAt, notified: false });
        saveClaims(claims);
        await interaction.reply({ content: `You have claimed \`${filename}\` for ${CLAIM_DURATION_DAYS} ${pluralizeDay(CLAIM_DURATION_DAYS)}.`, flags: MessageFlags.Ephemeral });
        // Post in configured #ok channel
        if (interaction.guildId) {
            const config = loadServerConfig(interaction.guildId);
            if (config.okChannelId) {
                const okChannel = await client.channels.fetch(config.okChannelId);
                if (okChannel && okChannel.isTextBased && okChannel.isTextBased() && 'send' in okChannel) {
                    await (okChannel as any).send(`${interaction.user.id} has just claimed ${filename} for the day.`);
                }
            }
        }
    } else if (interaction.commandName === 'unclaim') {
        const filename = interaction.options.getString('filename');
        if (!filename) {
            await interaction.reply({ content: 'Filename not found.', flags: MessageFlags.Ephemeral });
            return;
        }
        let claims = loadClaims();
        const claimIndex = claims.findIndex(c => c.filename === filename && c.userId === interaction.user.id && !dayjs().isAfter(dayjs(c.expiresAt)));
        if (claimIndex === -1) {
            await interaction.reply({ content: 'You do not have an active claim on this filename.', flags: MessageFlags.Ephemeral });
            return;
        }
        claims.splice(claimIndex, 1);
        saveClaims(claims);
        await interaction.reply({ content: `You have unclaimed \`${filename}\`.`, flags: MessageFlags.Ephemeral });
    } else if (interaction.commandName === 'setokchannel') {
        if (!interaction.memberPermissions?.has('Administrator')) {
            await interaction.reply({ content: 'Only server admins can set the ok channel.', flags: MessageFlags.Ephemeral });
            return;
        }
        const channel = interaction.options.getChannel('channel');
        if (!channel || channel.type !== 0) { // 0 = GUILD_TEXT
            await interaction.reply({ content: 'Please select a text channel.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (!interaction.guildId) {
            await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
            return;
        }
        const config = loadServerConfig(interaction.guildId);
        config.okChannelId = channel.id;
        saveServerConfig(interaction.guildId, config);
        await interaction.reply({ content: `OK channel set to <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
    }
});

registerCommands();
client.login(process.env.DISCORD_TOKEN);
