"use strict";

import axios from "axios";
import crypto from "crypto";

/*
 * ============================================================
 * FRANXX MD - SPOTIFY SEARCH
 * ============================================================
 *
 * Command:
 *   .spotify <query/link>
 *   .sp <query/link>
 *
 * Contoh:
 *   .spotify NIKI lowkey
 *   .sp NIKI
 *   .spotify https://open.spotify.com/track/xxxx
 *
 * Category:
 *   search
 *
 * Limit:
 *   5
 *
 * ============================================================
 */

class Spotify {

  constructor() {

    this.secret =
      "376136387538459893883312310911992847112448894410210511297108";

    this.version =
      61;

    this.client_version =
      "1.2.88.61.ge172202b";

    this.api =
      axios.create({
        timeout: 30000,

        headers: {
          referer:
            "https://open.spotify.com/",

          origin:
            "https://open.spotify.com",

          accept:
            "application/json",

          "content-type":
            "application/json",

          "user-agent":
            "Mozilla/5.0"
        }
      });
  }

  /*
   * ==========================================================
   * TOTP
   * ==========================================================
   */

  generateTOTP(
    tsms = Date.now()
  ) {

    const counter =
      Math.floor(
        tsms / 1000 / 30
      );

    const buffer =
      Buffer.alloc(8);

    buffer.writeBigInt64BE(
      BigInt(counter)
    );

    const digest =
      crypto
        .createHmac(
          "sha1",
          Buffer.from(
            this.secret,
            "utf8"
          )
        )
        .update(buffer)
        .digest();

    const offset =
      digest[
        digest.length - 1
      ] & 0xf;

    const code =
      (
        digest.readUInt32BE(
          offset
        ) &
        0x7fffffff
      ) % 1000000;

    return String(code)
      .padStart(6, "0");
  }

  /*
   * ==========================================================
   * GET TOKEN
   * ==========================================================
   */

  async getToken() {

    if (
      this.api.defaults
        .headers
        .authorization
    ) {
      return true;
    }

    const sts =
      Math.floor(
        Date.now() / 1000
      );

    const {
      data: token
    } =
      await this.api.get(
        "https://open.spotify.com/api/token",
        {
          params: {
            reason:
              "init",

            productType:
              "web-player",

            totp:
              this.generateTOTP(
                Date.now()
              ),

            totpServer:
              this.generateTOTP(
                sts * 1000
              ),

            totpVer:
              String(
                this.version
              )
          }
        }
      );

    if (
      !token?.accessToken ||
      !token?.clientId
    ) {
      throw new Error(
        "Token Spotify tidak ditemukan."
      );
    }

    const {
      data: client
    } =
      await this.api.post(
        "https://clienttoken.spotify.com/v1/clienttoken",
        {
          client_data: {
            client_version:
              this.client_version,

            client_id:
              token.clientId,

            js_sdk_data: {
              device_brand:
                "unknown",

              device_model:
                "unknown",

              os:
                "linux",

              os_version:
                "24.04",

              device_id:
                crypto.randomUUID(),

              device_type:
                "computer"
            }
          }
        }
      );

    if (
      !client?.granted_token?.token
    ) {
      throw new Error(
        "Client token Spotify tidak ditemukan."
      );
    }

    Object.assign(
      this.api.defaults.headers,
      {
        "accept-language":
          "en",

        "app-platform":
          "WebPlayer",

        authorization:
          `Bearer ${token.accessToken}`,

        "client-token":
          client.granted_token.token,

        "spotify-app-version":
          this.client_version
      }
    );

    return true;
  }

  /*
   * ==========================================================
   * GRAPHQL QUERY
   * ==========================================================
   */

  async query(
    operationName,
    sha256Hash,
    variables
  ) {

    await this.getToken();

    const {
      data
    } =
      await this.api.post(
        "https://api-partner.spotify.com/pathfinder/v2/query",
        {
          variables,

          operationName,

          extensions: {
            persistedQuery: {
              version:
                1,

              sha256Hash
            }
          }
        }
      );

    return data;
  }

  /*
   * ==========================================================
   * SEARCH
   * ==========================================================
   */

  async search(q) {

    const data =
      await this.query(
        "searchDesktop",

        "21b3fe49546912ba782db5c47e9ef5a7dbd20329520ba0c7d0fcfadee671d24e",

        {
          searchTerm:
            q,

          offset:
            0,

          limit:
            10,

          numberOfTopResults:
            5,

          includeAudiobooks:
            true,

          includeArtistHasConcertsField:
            false,

          includePreReleases:
            true,

          includeAuthors:
            false,

          includeEpisodeContentRatingsV2:
            false
        }
      );

    return data?.data?.searchV2;
  }

  /*
   * ==========================================================
   * TRACK DETAIL
   * ==========================================================
   */

  async track(id) {

    const data =
      await this.query(
        "getTrack",

        "612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294",

        {
          uri:
            `spotify:track:${id}`
        }
      );

    return data?.data?.trackUnion;
  }
}

/*
 * ============================================================
 * SPOTIFY INSTANCE
 * ============================================================
 */

const spotify =
  new Spotify();

/*
 * ============================================================
 * PARSE SPOTIFY URL
 * ============================================================
 */

function spotifyUrl(
  text = ""
) {

  const match =
    String(text).match(
      /open\.spotify\.com\/(track)\/([a-zA-Z0-9]+)/i
    );

  if (!match) {
    return null;
  }

  return {
    type:
      match[1],

    id:
      match[2]
  };
}

/*
 * ============================================================
 * FORMAT DURASI
 * ============================================================
 */

function msToTime(
  ms = 0
) {

  const sec =
    Math.floor(
      Number(ms || 0) / 1000
    );

  const min =
    Math.floor(
      sec / 60
    );

  const s =
    sec % 60;

  return `${min}:${String(s).padStart(2, "0")}`;
}

/*
 * ============================================================
 * IMAGE
 * ============================================================
 */

function getImages(
  object
) {
  return object?.sources || [];
}

function getBestImage(
  images = []
) {

  return (
    images?.[0]?.url ||
    images?.[images.length - 1]?.url ||
    null
  );
}

/*
 * ============================================================
 * PARSE TRACK
 * ============================================================
 */

function parseTrack(
  track
) {

  if (!track) {
    return null;
  }

  const id =
    track.uri
      ?.split(":")
      ?.at(2);

  return {

    id,

    url:
      id
        ? `https://open.spotify.com/track/${id}`
        : null,

    title:
      track.name ||
      "-",

    duration:
      track.duration
        ?.totalMilliseconds ||
      0,

    playcount:
      Number(
        track.playcount ||
        0
      ),

    explicit:
      track.contentRating
        ?.label ===
      "EXPLICIT",

    artists: [
      ...(track.firstArtist?.items || []),

      ...(track.otherArtists?.items || []),

      ...(track.artists?.items || [])
    ]
      .map(
        item =>
          item?.profile?.name
      )
      .filter(Boolean),

    album: {

      name:
        track.albumOfTrack
          ?.name ||
        "-",

      year:
        track.albumOfTrack
          ?.date
          ?.year ||
        "-",

      image:
        getBestImage(
          getImages(
            track.albumOfTrack
              ?.coverArt
          )
        )
    }
  };
}

/*
 * ============================================================
 * PARSE SEARCH
 * ============================================================
 */

function parseSearch(
  data
) {

  const tracks =
    data?.tracksV2?.items ||
    data?.topResultsV2
      ?.itemsV2
      ?.filter(
        item =>
          item?.item
            ?.__typename ===
          "TrackResponseWrapper"
      ) ||
    [];

  return tracks
    .map(
      node => {

        const track =
          node?.item?.data ||
          node?.data;

        if (!track) {
          return null;
        }

        const id =
          track.uri
            ?.split(":")
            ?.at(2);

        return {

          id,

          url:
            id
              ? `https://open.spotify.com/track/${id}`
              : null,

          title:
            track.name ||
            "-",

          duration:
            track.duration
              ?.totalMilliseconds ||
            0,

          explicit:
            track.contentRating
              ?.label ===
            "EXPLICIT",

          artists:
            (
              track.artists
                ?.items ||
              []
            )
              .map(
                item =>
                  item?.profile?.name
              )
              .filter(Boolean),

          album: {

            name:
              track.albumOfTrack
                ?.name ||
              "-",

            image:
              getBestImage(
                getImages(
                  track.albumOfTrack
                    ?.coverArt
                )
              )
          }
        };
      }
    )
    .filter(Boolean);
}

/*
 * ============================================================
 * FORMAT TRACK
 * ============================================================
 */

function formatTrack(
  track
) {

  return [
    "╭━━〔 🎧 SPOTIFY TRACK 〕━━╮",
    "┃",
    `┃ 🎵 *Judul:* ${track.title}`,
    `┃ 👤 *Artist:* ${track.artists.join(", ") || "-"}`,
    `┃ 💿 *Album:* ${track.album.name}`,
    `┃ 📅 *Rilis:* ${track.album.year}`,
    `┃ ⏱️ *Durasi:* ${msToTime(track.duration)}`,
    `┃ ▶️ *Playcount:* ${track.playcount.toLocaleString("id-ID")}`,
    `┃ 🔞 *Explicit:* ${track.explicit ? "Ya" : "Tidak"}`,
    "┃",
    `┃ 🔗 ${track.url}`,
    "┃",
    "╰━━━━━━━━━━━━━━━━━━━━╯"
  ].join("\n");
}

/*
 * ============================================================
 * FORMAT SEARCH
 * ============================================================
 */

function formatSearch(
  list,
  query
) {

  const items =
    list
      .slice(0, 10)
      .map(
        (track, index) =>
          [
            `${index + 1}. *${track.title}*`,
            `   👤 ${track.artists.join(", ") || "-"}`,
            `   💿 ${track.album.name}`,
            `   ⏱️ ${msToTime(track.duration)}`,
            `   🔗 ${track.url}`
          ].join("\n")
      )
      .join("\n\n");

  return [
    "╭━━〔 🎧 SPOTIFY SEARCH 〕━━╮",
    "┃",
    `┃ 🔎 Query: *${query}*`,
    "┃",
    items,
    "┃",
    "╰━━━━━━━━━━━━━━━━━━━━╯"
  ].join("\n");
}

/*
 * ============================================================
 * GET TEXT
 * ============================================================
 */

function getInput(
  context = {}
) {

  const {
    text,
    args,
    m
  } = context;

  if (
    typeof text ===
      "string" &&
    text.trim()
  ) {
    return text.trim();
  }

  if (
    Array.isArray(args) &&
    args.length
  ) {
    return args
      .join(" ")
      .trim();
  }

  if (
    typeof m?.text ===
      "string" &&
    m.text.trim()
  ) {
    return m.text.trim();
  }

  if (
    typeof m?.body ===
      "string" &&
    m.body.trim()
  ) {
    return m.body.trim();
  }

  return "";
}

/*
 * ============================================================
 * PLUGIN
 * ============================================================
 */

export default {

  name:
    "spotify",

  command: [
    "spotify",
    "sp"
  ],

  category:
    "search",

  description:
    "Search lagu dan informasi track Spotify.",

  /*
   * Setiap command Spotify
   * mengonsumsi 5 limit.
   */
  limit:
    5,

  premium:
    false,

  async execute(
    context
  ) {

    const {
      sock,
      m,
      command
    } = context;

    const input =
      getInput(
        context
      );

    /*
     * ========================================================
     * INPUT KOSONG
     * ========================================================
     */

    if (!input) {

      const prefix =
        ".";

      return m.reply(
        [
          "╭━━〔 🎧 SPOTIFY 〕━━╮",
          "┃",
          "┃ ❌ Query belum diberikan.",
          "┃",
          "┃ 📌 Contoh:",
          `┃ ${prefix}${command || "spotify"} NIKI lowkey`,
          `┃ ${prefix}${command || "spotify"} https://open.spotify.com/track/xxxx`,
          "┃",
          "┃ 💳 Konsumsi: 5 limit",
          "┃",
          "╰━━━━━━━━━━━━━━━━━━━━╯"
        ].join("\n")
      );
    }

    /*
     * ========================================================
     * PROCESS
     * ========================================================
     */

    await m.react?.(
      "🕒"
    );

    try {

      /*
       * ======================================================
       * TRACK URL
       * ======================================================
       */

      const parsed =
        spotifyUrl(
          input
        );

      if (
        parsed?.type ===
        "track"
      ) {

        const raw =
          await spotify.track(
            parsed.id
          );

        const data =
          parseTrack(
            raw
          );

        if (!data) {
          throw new Error(
            "Track Spotify tidak ditemukan."
          );
        }

        const caption =
          formatTrack(
            data
          );

        /*
         * Kirim cover album jika tersedia.
         */

        if (
          data.album.image
        ) {

          await sock.sendMessage(
            m.jid,
            {
              image: {
                url:
                  data.album.image
              },

              caption
            },
            {
              quoted:
                m.raw
            }
          );

        } else {

          await m.reply(
            caption
          );
        }

        await m.react?.(
          "✅"
        );

        return;
      }

      /*
       * ======================================================
       * SEARCH
       * ======================================================
       */

      const raw =
        await spotify.search(
          input
        );

      const list =
        parseSearch(
          raw
        );

      if (
        !list.length
      ) {
        throw new Error(
          "Lagu tidak ditemukan."
        );
      }

      const caption =
        formatSearch(
          list,
          input
        );

      const thumb =
        list[0]
          ?.album
          ?.image;

      /*
       * ======================================================
       * SEND RESULT
       * ======================================================
       */

      if (thumb) {

        await sock.sendMessage(
          m.jid,
          {
            image: {
              url:
                thumb
            },

            caption
          },
          {
            quoted:
              m.raw
          }
        );

      } else {

        await m.reply(
          caption
        );
      }

      await m.react?.(
        "✅"
      );

    } catch (error) {

      await m.react?.(
        "❌"
      );

      console.error(
        "[SPOTIFY] Error:",
        error?.stack ||
        error?.message ||
        error
      );

      return m.reply(
        [
          "╭━━〔 ❌ SPOTIFY ERROR 〕━━╮",
          "┃",
          `┃ ${error?.message || "Gagal mengambil data Spotify."}`,
          "┃",
          "┃ Silakan coba lagi nanti.",
          "┃",
          "╰━━━━━━━━━━━━━━━━━━━━╯"
        ].join("\n")
      );
    }
  }
};