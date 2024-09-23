import '../../../../../../model/source.dart';

Source get luckymangaSource => _luckymangaSource;
Source _luckymangaSource = Source(
    name: "Lucky Manga",
    baseUrl: "https://luckymanga.com",
    lang: "es",
    isNsfw: false,
    typeSource: "madara",
    iconUrl:
        "https://raw.githubusercontent.com/yxxyun/mangayomi-extensions/bbranchNamee/dart/manga/multisrc/madara/src/luckymanga/icon.png",
    dateFormat: "d MMMM, yyyy",
    dateFormatLocale: "es");
