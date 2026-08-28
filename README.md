# نظام المحاسب — منظومة محاسبية عربية شاملة

نظام محاسبة مالية متكامل باللغة العربية (RTL) بعملة الريال السعودي (ر.س)، يدعم شركات متعددة، لكل شركة قاعدة بيانات مستقلة قابلة للإغلاق وترحيلها إلى سنة مالية جديدة.

## المميزات

- **شركات متعددة**: لكل شركة ملف قاعدة بيانات مستقل (`company_<id>.db`).
- **دليل حسابات حسب النشاط**: شركات (corporate)، سوبر ماركت (supermarket)، مصانع (factory)، مختبرات طبية (medical_lab).
- **ضريبة القيمة المضافة السعودية**: معدل 15%، تقارير ضريبية حسب الفترة، الحسابات 1401 (ضريبة مشتريات) و 2103 (ضريبة مبيعات).
- **الفاتورة الإلكترونية (ZATCA)**: توليد فاتورة إلكترونية متوافقة مع هيئة الزكاة والدخل والجمارك (رمز QR بتنسيق TLV + ملف XML بصيغة UBL 2.1 مع تجزئة SHA-256 وتوقيع ECDSA P-256)، مع إرسال تلقائي إلى منظومة فاتورة عند حفظ فاتورة البيع (إبلاغ / اعتماد).
- **طرق دفع شائعة**: نقدي، مدى، بطاقة ائتمانية، تحويل بنكي، سداد، Apple Pay، STC Pay، شيك، آجل، وغيرها.
- **دفتر اليومية، دفتر الأستاذ، ميزان المراجعة، قائمة الدخل، الميزانية العمومية، تقرير الضريبة**.
- **الفوترة**: فواتير بيع وشراء مع ترحيل تلقائي للقيود، تحصيل جزئي/آجل للعملاء والموردين.
- **إقفال السنة**: قيد إقفال + قيد افتتاحي آلي مع ترحيل أرصدة إلى السنة المالية الجديدة.

## التشغيل

```
npm install
node seed.js
node server.js
```

ثم افتح `http://localhost:3001`.

## سير العمل

1. إنشاء شركة (الاسم، النشاط، رقم السجل، رقم ضريبة القيمة المضافة، معدل الضريبة، بداية السنة المالية).
2. الاطلاع على الحسابات التي تم تكوينها تلقائيًا حسب النشاط.
3. تسجيل قيود اليومية / الفواتير / العملاء والموردين.
4. استعراض التقارير (ميزان المراجعة، قائمة الدخل، الميزانية، تقرير الضريبة).
5. عند انتهاء السنة المالية: إقفال السنة ثم فتح سنة مالية جديدة تلقائيًا.

## الربط مع هيئة الزكاة (ZATCA)

1. سجّل منشأتك في بوابة هيئة الزكاة واحصل على بيانات الاعتماد (CSID) — ابدأ بوضع Sandbox للاختبار.
2. من شاشة **الإعدادات → الفاتورة الإلكترونية ZATCA**: فعّل الإرسال، حدد الوضع (Sandbox/Production)، وألصق CSID والمفتاح الخاص (PEM) والشهادة.
3. عند حفظ أي فاتورة بيع يُنشأ النظام تلقائياً:
   - **رمز QR** بتنسيق TLV (اسم البائع، الرقم الضريبي، الوقت، الإجمالي، الضريبة + التجزئة والتوقيع عند التفعيل).
   - **ملف XML** بصيغة UBL 2.1 (فاتورة مبسطة B2C أو قياسية B2B حسب الرقم الضريبي للعميل).
   - إرسال تلقائي إلى منظومة فاتورة (إبلاغ للفواتير المبسطة، واعتماد للفواتير القياسية التي تتجاوز 1000 ر.س).
4. يمكن من قائمة فواتير البيع عرض تفاصيل الفاتورة الإلكترونية (QR + XML + الحالة) وإعادة الإرسال.

تُخزن حالة الإرسال لكل فاتورة (`zatca_status`): `not_configured` / `submitting` / `submitted` / `cleared` / `failed`.

## البنية

| الملف | الوصف |
|-------|-------|
| `server.js` | خادم Express (المنفذ 3001) + الملفات الثابتة |
| `lib/master-db.js` | سجل الشركات `data/app.db` |
| `lib/company-db.js` | مخطط قاعدة بيانات الشركة + طرق الدفع الافتراضية |
| `lib/charts.js` | دليل الحسابات حسب النشاط |
| `lib/accounting.js` | العمليات المحاسبية + إقفال السنة |
| `lib/invoices.js` | الفوترة والتحصيل والترحيل التلقائي + توليد الفاتورة الإلكترونية |
| `lib/parties.js` | العملاء والموردون |
| `lib/zatca/` | الفاتورة الإلكترونية ZATCA (QR + XML + التوقيع + الإرسال) |
| `seed.js` | بيانات تجريبية لـ 4 شركات |
| `public/` | واجهة الويب (Vue 3 SPA بدون خطوة بناء) |

## نظرة عامة على الواجهة

جميع الشاشات بالعربية: لوحة التحكم، الحسابات، دفتر اليومية، دفتر الأستاذ، ميزان المراجعة، قائمة الدخل، الميزانية العمومية، تقرير ضريبة القيمة المضافة، فواتير البيع والشراء، العملاء والموردون، إقفال السنة، الإعدادات.

# Hi there, I'm Asem Shahen 👋

An active Software Developer passionate about building useful open-source tools, automation scripts, and solving problems using **C#** and **Python**.

---

### 🛠️ My Tech Stack & Skills
- **Languages:** C#, Python, SQL
- **Specialties:** Automation, Scripting, Desktop Applications, Easy Setup Tools

---

### 🌟 Support My Open-Source Work

Since official GitHub Sponsors is restricted in my region, you can back my projects and support my journey through these alternative methods:

#### 🪙 Crypto Support (USDT / Crypto Wallets)
If you find my tools helpful, you can send a tip via Crypto:
* **USDT (Network: TRON): TU68gmFAkWzMuqfPeEw3GWWurPa8CcWjG9
* **Bitcoin : bc1qg2wkx9t6yakskwplds9n8n24mca5ulnaeslznr
#### ✉️ Contact & Freelancing
Looking for a developer for remote work, custom scripts, or automation tools? Let's connect!
* **Email:** [asemshahen5@gmail.com](mailto:asemshahen5@gmail.com) - [asem6600@hotmail.com](mailto:asem6600@hotmail.com)
* **Telegram / LinkedIn:** [Your_Link_Here]

---
*Thank you for supporting independent developers worldwide! ✨*
