// İstemci ve sunucunun paylaştığı, SDK bağımsız sohbet sabitleri.

export const ASSISTANT_NAME = "Reach";

/** İstemcinin gösterdiği ilk mesaj. Sunucuya geçmişin parçası olarak gelir. */
export const GREETING = `Merhaba, ben ${ASSISTANT_NAME}. NextReach ekibinin iletişim asistanıyım. Analitik tarafında size nasıl yardımcı olabilirim?`;

/** Karşılama mesajının altındaki hızlı cevaplar. */
export const GREETING_CHIPS = ["Kârlılığı göremiyorum", "Fiyat sormak istiyorum", "Kanalları karşılaştıramıyorum", "Sadece bakıyorum"];

/** Baloncuk metni: sayfa yüklendikten TEASER_DELAY_MS sonra, oturumda bir kez. */
export const TEASER_TEXT = `Merhaba, ben ${ASSISTANT_NAME}. Analitik tarafında size nasıl yardımcı olabilirim?`;
export const TEASER_DELAY_MS = 6000;
export const TEASER_SESSION_KEY = "nr_teaser_shown";

/** Kapanışta paylaşılan satış adresi. YER TUTUCU: gerçek adresi SALES_EMAIL env değişkeniyle verin. */
export const DEFAULT_SALES_EMAIL = "satis@nextreach.com";
