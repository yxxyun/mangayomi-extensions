import '../../../../../../model/source.dart';

Source get kuroimangaSource => _kuroimangaSource;
Source _kuroimangaSource = Source(
    name: "Kuroi Manga",
    baseUrl: "https://kuroimanga.com",
    lang: "tr",
    isNsfw: false,
    typeSource: "madara",
    iconUrl:
        "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/bbranchNamee/dart/manga/multisrc/madara/src/kuroimanga/icon.png",
    dateFormat: "d MMMM yyyy",
    dateFormatLocale: "tr");
