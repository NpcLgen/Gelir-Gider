/**
 * Akordiyon menüde gezinme yardımcısı.
 *
 * PRD v2.0 §1.3 gereği aynı anda yalnızca bir ana kategori açık kalır; bu
 * yüzden hedef `.nav-item` görünür olmayabilir. Yardımcı, öğeyi bulana kadar
 * grup başlıklarını sırayla açar.
 */

/** Menü etiketleri emoji ile başlar; sondan eşleşmek "Ayarlar"ı "Oda Ayarları"ndan ayırır. */
const rx = (label) => new RegExp(`${label}\\s*$`);

export function makeGo(page) {
  return async function go(label) {
    const target = () => page.locator('.nav-sub .nav-item').filter({ hasText: rx(label) }).first();

    // Mobil/tablet genişliklerinde kenar çubuğu gizlidir; varsa önce açılır.
    const menuBtn = page.locator('.menu-btn');
    if (await menuBtn.count() && await menuBtn.isVisible()) {
      if (!(await page.locator('.sidebar.open').count())) await menuBtn.click();
    }

    if (await target().count() && await target().first().isVisible()) {
      await target().click();
      return;
    }

    const groupCount = await page.locator('.nav-group').count();
    for (let i = 0; i < groupCount; i += 1) {
      const group = page.locator('.nav-group').nth(i);
      // Zaten açık bir gruba tıklamak onu kapatır; yalnızca kapalıları açarız.
      if ((await group.getAttribute('aria-expanded')) === 'true') continue;
      await group.click();
      if (await target().count()) {
        await target().click();
        return;
      }
    }
    throw new Error(`menüde bulunamadı: ${label}`);
  };
}

export { rx as navLabelPattern };
