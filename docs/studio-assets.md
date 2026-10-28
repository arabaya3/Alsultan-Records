# أصول تجربة الاستوديو: المصادر والتراخيص

كل الأصول الخارجية من **Poly Haven** ([polyhaven.com](https://polyhaven.com)) بترخيص **CC0 1.0**: ملكية عامة، يجوز الاستخدام التجاري، ولا يُشترط ذكر المصدر.

- حُمّلت بنسخة 1k من الـ API الرسمي (`api.polyhaven.com/files/<asset>`).
- لم يُشترَ أي أصل، ولم يُستخدم أصل مجهول الترخيص.
- **لم تُستخدم صور مولّدة ولا صور من الإنترنت للمحتوى:** كل صور الأعمال والشعار وملصق الفيلم من محتوى الموقع المنشور.

## النماذج (`web/public/studio/models/`)

حُوّلت النماذج إلى GLB بالأمر:

```
@gltf-transform/cli@4.5.1 optimize --texture-compress webp --texture-size 512 --compress meshopt
```

| الملف | أصل Poly Haven | الحجم بعد الضغط | الاستخدام |
|---|---|---|---|
| `desk_lamp_arm_01.glb` | desk_lamp_arm_01 | 288 KB | مصباح المكتب، وطاولة البكجات، وطاولة الألبوم |
| `vintage_video_camera.glb` | vintage_video_camera | 273 KB | كاميرا على مكتب الاستقبال، وطاولة البكجات، وطاولة الألبوم |
| `mid_century_lounge_chair.glb` | mid_century_lounge_chair | 121 KB | كرسي زاوية العرض، وزاوية من نحن |
| `potted_plant_02.glb` | potted_plant_02 | 615 KB | نباتات الغرفة (المستوى العالي فقط) |
| `wooden_bookshelf_worn.glb` | wooden_bookshelf_worn | 183 KB | مكتبة زاوية من نحن، مع صفوف كتب مبنية بالكود |
| `side_table_01.glb` | side_table_01 | 83 KB | طاولة جانبية في زاوية العرض |
| `brass_vase_01.glb` | brass_vase_01 | 152 KB | مزهرية نحاسية: الاستقبال، وزاوية العرض |

## الخامات (`web/public/studio/tex/`)

- **التحويل:** صيغة WebP.
- **الدقة:** لون 1024، و«normal» 512.
- **«roughness»:** للجبس فقط. خرائط الخشب والجلد جعلت الأسطح لامعة كالمرآة تحت إضاءة الغرفة، فاستُبدلت بقيم ثابتة معايرة.

| الملفات | أصل Poly Haven | الحجم | الاستخدام |
|---|---|---|---|
| `clay_plaster_{color,normal,rough}.webp` | clay_plaster | 55 KB | الجدران |
| `herringbone_parquet_{color,normal}.webp` | herringbone_parquet | 147 KB | الأرضية (باركيه متعرّج) |
| `black_walnut_veneer_01_{color,normal}.webp` | black_walnut_veneer_01 | 78 KB | الجوز: الأثاث والإطارات والتجليد |
| `brown_leather_{color,normal}.webp` | brown_leather | 229 KB | الجلد: غلاف الألبوم، ولوح المكتب |

**المجموع في Git:** نحو 2.2 MB (النماذج 1.7 MB والخامات 0.5 MB).

- **التحميل:** يجري بعد ظهور المشهد، على مراحل، ولا ينتظره المحتوى.

## مبني بالكود (من كتابة هذا العمل)

- الغرفة والجدران والإزار الخشبي والسقف.
- النافذة والباب.
- المكتب المضلّع والطاولات.
- إطارات الصور بمقاس الصورة الحقيقي، والحبل والمشابك وإضاءة اللوحات.
- الألبوم المفتوح: كتلتا صفحات، وغلافان، ومفصل، وكعب.
- الشاشة والسمّاعات.
- حامل الكاميرا والكاميرا السينمائية وصندوق الإضاءة وحقائب المعدات.
- السجادة وصفوف الكتب.

**المصدر:** `web/src/features/studio/engine/room.ts` و`textures.ts`.

## من مواد الاستوديو نفسه

- `web/public/studio/promo-still.webp` (50KB): لقطة من فيلم الاستوديو الترويجي (ملك الاستوديو)، الثانية 11.1، مقصوصة بلا نص العنوان أو الشعار. تُعرض على إطار «الفيديوهات» وعلى الشاشة.

## المكتبات

| المكتبة | الإصدار | الترخيص |
|---|---|---|
| three.js | 0.186.1 | MIT |
| ‏`RoomEnvironment` و`GLTFLoader` و`meshopt_decoder` | من three/examples | MIT |
| GSAP | 3.15.0، موجودة مسبقًا | GSAP Standard "no charge" License |
