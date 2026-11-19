import 'dart:convert';
import 'dart:developer';
import 'dart:io';
import 'dart/anime/anime_source_list.dart';
import 'dart/manga/manga_source_list.dart';
import 'dart/novel/novel_source_list.dart';
import 'model/source.dart';

/// Sources live in a flat per-type tree, one directory each:
///
///   javascript/anime/<name>.js
///   javascript/manga/<name>.js
///   javascript/novel/<name>.js
///
/// The type comes from the directory, and pkgPath is derived from where the
/// file actually is, so a source never has to repeat its own location.
void main() {
  final jsSources = _searchJsSources(Directory("javascript"));
  genManga(
      jsSources.where((element) => element.itemType!.name == "manga").toList());
  genAnime(
      jsSources.where((element) => element.itemType!.name == "anime").toList());
  genNovel(
      jsSources.where((element) => element.itemType!.name == "novel").toList());
}

void _writeIndex(String fileName, List<Source> sources) {
  final List<Map<String, dynamic>> jsonList =
      sources.map((source) => source.toJson()).toList();
  final file = File(fileName);
  // Always UTF-8: these carry Chinese names, and the platform default on
  // Windows is not UTF-8.
  file.writeAsStringSync(jsonEncode(jsonList), encoding: utf8);
  log('JSON file created: ${file.path} (${jsonList.length} sources)');
}

void genManga(List<Source> jsMangasourceList) {
  final List<Source> mangaSources = [...dartMangasourceList, ...jsMangasourceList];
  _writeIndex('index.json', mangaSources);
}

void genAnime(List<Source> jsAnimesourceList) {
  final List<Source> animeSources = [...dartAnimesourceList, ...jsAnimesourceList];
  _writeIndex('anime_index.json', animeSources);
}

void genNovel(List<Source> jsNovelSourceList) {
  final List<Source> novelSources = [...dartNovelSourceList, ...jsNovelSourceList];
  _writeIndex('novel_index.json', novelSources);
}

/// Walks [dir] recursively (the tree is flat now, but a nested file must not be
/// silently skipped) and parses the mangayomiSources block out of every .js.
List<Source> _searchJsSources(Directory dir) {
  final List<Source> sourceList = [];
  if (!dir.existsSync()) return sourceList;

  for (final entity in dir.listSync(recursive: true, followLinks: false)) {
    if (entity is! File || !entity.path.endsWith('.js')) continue;
    sourceList.addAll(_sourcesInFile(entity, root: dir.path));
  }
  return sourceList;
}

List<Source> _sourcesInFile(File file, {required String root}) {
  final sourceList = <Source>[];
  final defaultSource = Source();
  final regex = RegExp(
    r'const\s+mangayomiSources\s*=\s*(\[.*?\])\s*;',
    dotAll: true,
  );
  final match = regex.firstMatch(file.readAsStringSync());
  if (match == null) return sourceList;

  // javascript/anime/ffzy.js -> anime/ffzy.js
  final relative = file.path
      .replaceAll(r'\', '/')
      .replaceFirst(RegExp('^${RegExp.escape(root)}/'), '');
  // The type directory decides the itemType when the source does not say.
  final typeDir = relative.contains('/') ? relative.split('/').first : '';

  for (final sourceJson in jsonDecode(match.group(1)!) as List) {
    final map = sourceJson as Map<String, dynamic>;
    final langs = map["langs"] as List?;
    Source source = Source.fromJson(map)
      // Source.sourceCodeLanguage is an int in this model; 1 is javascript.
      ..sourceCodeLanguage = 1
      ..appMinVerReq = map["appMinVerReq"] ?? defaultSource.appMinVerReq
      // Derived, never hand-written: the URL has to match the file that is
      // actually in the repository, and it is served from the published base.
      ..sourceCodeUrl = "$jsBaseUrl/javascript/$relative";
    if (map["itemType"] == null) {
      source.itemType = switch (typeDir) {
        'anime' => ItemType.anime,
        'novel' => ItemType.novel,
        _ => ItemType.manga,
      };
    }
    if (map["id"] != null) {
      source = source..id = int.tryParse("${map["id"]}");
    }
    if (langs?.isNotEmpty ?? false) {
      for (final lang in langs!) {
        sourceList.add(Source.fromJson(source.toJson())
          ..lang = lang
          ..id = 'mangayomi-js-"$lang"."${source.name}"'.hashCode);
      }
    } else {
      sourceList.add(source);
    }
  }
  return sourceList;
}
