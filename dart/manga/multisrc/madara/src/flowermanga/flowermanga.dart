import '../../../../../../model/source.dart';

Source get flowermangaSource => _flowermangaSource;
Source _flowermangaSource = Source(
    name: "Flower Manga",
    baseUrl: "https://flowermanga.net",
    lang: "pt-br",
    isNsfw: false,
    typeSource: "madara",
    iconUrl:
        "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/bbranchNamee/dart/manga/multisrc/madara/src/flowermanga/icon.png",
    dateFormat: "d 'de' MMMMM 'de' yyyy",
    dateFormatLocale: "pt-br");
