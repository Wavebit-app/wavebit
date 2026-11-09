//! Tags for a song wavebit has just downloaded, written before it joins the
//! library so the scan (and the matching that follows it) sees a named song.

use lofty::config::WriteOptions;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::Tag;
use napi::bindgen_prelude::Buffer;
use napi::{Error, Result, Status};
use napi_derive::napi;
use std::path::Path;

#[napi(object)]
pub struct SongTags {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub cover: Option<Buffer>,
    pub cover_mime: Option<String>,
    pub lyrics: Option<String>,
}

struct Cover<'a> {
    data: &'a [u8],
    mime: &'a str,
}

fn write(
    path: &Path,
    title: &str,
    artist: &str,
    album: Option<&str>,
    cover: Option<Cover<'_>>,
    lyrics: Option<&str>,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut file = lofty::read_from_path(path)?;
    if file.primary_tag().is_none() {
        let kind = file.primary_tag_type();
        file.insert_tag(Tag::new(kind));
    }
    let Some(tag) = file.primary_tag_mut() else {
        return Ok(());
    };
    tag.set_title(title.to_string());
    tag.set_artist(artist.to_string());
    if let Some(album) = album.filter(|a| !a.is_empty()) {
        tag.set_album(album.to_string());
    }
    if let Some(lyrics) = lyrics.filter(|l| !l.is_empty()) {
        tag.insert_text(ItemKey::Lyrics, lyrics.to_string());
    }
    if let Some(cover) = cover {
        tag.push_picture(
            Picture::unchecked(cover.data.to_vec())
                .pic_type(PictureType::CoverFront)
                .mime_type(MimeType::from_str(cover.mime))
                .build(),
        );
    }
    file.save_to_path(path, WriteOptions::default())?;
    Ok(())
}

/// Writes a song's title, artist, album and cover into its file.
#[napi]
pub fn write_tags(path: String, tags: SongTags) -> Result<()> {
    let cover = tags.cover.as_ref().map(|data| Cover {
        data,
        mime: tags.cover_mime.as_deref().unwrap_or("image/jpeg"),
    });
    write(
        Path::new(&path),
        &tags.title,
        &tags.artist,
        tags.album.as_deref(),
        cover,
        tags.lyrics.as_deref(),
    )
    .map_err(|e| Error::new(Status::GenericFailure, format!("tags: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny fragmented M4A, the shape yt-dlp saves when no ffmpeg tidies it.
    const FIXTURE: &[u8] = include_bytes!("../test-fixtures/fragmented.m4a");

    #[test]
    fn writes_tags_and_cover_a_scan_can_read() {
        let path = std::env::temp_dir().join(format!("wavebit-tags-{}.m4a", std::process::id()));
        std::fs::write(&path, FIXTURE).unwrap();
        let jpeg = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];

        write(
            &path,
            "Título",
            "Some Artist",
            Some("An Album"),
            Some(Cover {
                data: &jpeg,
                mime: "image/jpeg",
            }),
            Some("[00:01.00]words"),
        )
        .unwrap();

        let file = lofty::read_from_path(&path).unwrap();
        let tag = file.primary_tag().unwrap();
        assert_eq!(tag.title().as_deref(), Some("Título"));
        assert_eq!(tag.artist().as_deref(), Some("Some Artist"));
        assert_eq!(tag.album().as_deref(), Some("An Album"));
        assert_eq!(tag.pictures()[0].data(), jpeg);
        assert_eq!(tag.get_string(ItemKey::Lyrics), Some("[00:01.00]words"));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn a_file_that_is_not_audio_is_an_error() {
        let path = std::env::temp_dir().join(format!("wavebit-notes-{}.m4a", std::process::id()));
        std::fs::write(&path, b"<html>not audio</html>").unwrap();
        assert!(write(&path, "a", "b", None, None, None).is_err());
        std::fs::remove_file(&path).unwrap();
    }
}
