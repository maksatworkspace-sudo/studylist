import type { Store } from "./store/types";
import { passwordHash, passwordMatches, token } from "./security";

export const demoId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString();

/**
 * Published demo logins (user / teacher / leadership). Their password hashes
 * are (re)asserted on every adapter initialization so demos always work with
 * the documented credentials, even on databases seeded earlier.
 */
export const DEMO_PASSWORD = "Maxball2026";
export const demoLogins = {
  user: "demo1@maxball.example",
  teacher: "demo4@maxball.example",
  boss: "demo6@maxball.example",
} as const;
async function ensureDemoLogins(repo: Store) {
  for (const email of Object.values(demoLogins)) {
    const profile = await repo.first("profiles", { email });
    if (!profile) continue;
    const key = String(profile.id);
    const credential = await repo.get("local_credentials", key);
    if (credential && passwordMatches(DEMO_PASSWORD, String(credential.password_hash)))
      continue;
    const row = { profile_id: key, password_hash: passwordHash(DEMO_PASSWORD) };
    if (credential) await repo.update("local_credentials", key, row);
    else await repo.insert("local_credentials", row);
  }
}

/** Deterministic demo fixtures shared by every adapter. */
export async function seed(repo: Store) {
  if ((await repo.first("profiles", {})) !== undefined) {
    await ensureDemoLogins(repo);
    return;
  }
  await repo.transaction(async (tx) => {
    const people = [
      [1, "Аружан Әлім", "user"],
      [2, "Айша Нұрлан", "user"],
      [3, "Ерасыл Омар", "user"],
      [4, "Дана Әлім", "teacher"],
      [5, "Әлия Серік", "admin"],
      [6, "Аян Қуаныш", "leadership"],
    ] as const;
    for (const [n, name, role] of people) {
      await tx.insert("profiles", {
        id: demoId(n),
        name,
        email: `demo${n}@maxball.example`,
        phone: "+7 700 000 00 00",
        role,
        verified: true,
        active: true,
        created_at: hoursAgo(24 * 30),
      });
      await tx.insert("local_credentials", {
        profile_id: demoId(n),
        password_hash: passwordHash(token()),
      });
    }
    const courses = [
      "Математикалық сауаттылық",
      "Математика",
      "Қазақстан тарихы",
      "Ағылшын тілі",
      "Информатика",
    ];
    for (let i = 0; i < courses.length; i++)
      await tx.insert("courses", {
        id: demoId(100 + i),
        name: courses[i],
        active: true,
      });
    const teachers = [
      ["Дана Әлім", "Математикалық сауаттылық", "blue"],
      ["Аян Серік", "Математика", "mint"],
      ["Нұржан Омар", "Қазақстан тарихы", "amber"],
      ["Аружан Ермек", "Ағылшын тілі", "rose"],
      ["Әлихан Болат", "Информатика", "violet"],
    ];
    for (let i = 0; i < teachers.length; i++)
      await tx.insert("teachers", {
        id: demoId(200 + i),
        profile_id: i === 0 ? demoId(4) : null,
        name: teachers[i][0],
        subject: teachers[i][1],
        color: teachers[i][2],
        active: true,
      });
    const posts: [
      string,
      string,
      string,
      number | null,
      number | null,
      boolean,
      number,
      string | null,
      string | null,
    ][] = [
      ["suggestion", "Аптасына бір рет ашық сұрақ-жауап кездесуін өткізсек", "Сабақтан кейін кейбір сұрақтар қалып қояды. Әр жұмада барлық оқушы қатыса алатын қысқа сұрақ-жауап кездесуін өткізуді ұсынамын. Өзімізге қиын тақырыптарды алдын ала жіберсек, кездесу де пайдалырақ болар еді.", 0, 0, false, 1, "in_progress", null],
      ["opinion", "Математиканы түсіну әлдеқайда жеңіл болды", "Дана апай күрделі есепті қарапайым мысалмен түсіндіреді. Соңғы екі аптада пробныйдағы нәтижем өсті. Әсіресе сабақтан кейінгі қысқа түсіндірмелер қатты көмектесті. Рақмет!", 0, 0, false, 2, null, null],
      ["issue", "Сабақ жазбасының дыбысы кейде естілмейді", "Кешегі математика сабағының жазбасында 24-минуттан кейін дыбыс өте бәсеңдеп қалады. Бірнеше құрылғыдан тексеріп көрдім. Жазбаны қайта жүктеуге мүмкіндік бар ма?", 1, 1, true, 3, "reviewing", null],
      ["suggestion", "Тақырыптық конспектілерді PDF форматында қоссақ", "Тарихтағы даталарды қайталау үшін әр тақырыпқа бір беттік қысқа конспект болса өте ыңғайлы. Сабақ видеосын көргеннен кейін бекітуге жақсы көмектесер еді.", 2, 2, false, 3, "reviewed", "implemented"],
      ["issue", "Телефоннан тапсырма файлын аша алмадым", "Информатика курсындағы бүгінгі тапсырма файлы телефонда ашылмай тұр. Браузерді жаңартып та көрдім. Файлға қайта қолжетімділік беруді сұраймын.", 4, 4, true, 1, "new", null],
      ["opinion", "Орталықтағы қолдау ерекше ұнайды", "Топтағы атмосфера өте жылы. Қандай сұрақ болса да жауап аламын, ешкім сұрағыңа күліп қарамайды. Оқу процесін осылай ұйымдастырған командаға алғыс айтқым келеді.", null, null, false, 1, null, null],
      ["issue", "Қосымша сабақтың сілтемесі жаңартылды", "Сенбі күнгі қосымша сабақтың сілтемесі ескі болып қалған еді. Әкімшілік жаңа сілтемені жіберді, қазір бәрі ашылып тұр. Жедел жауап бергендеріңізге рақмет.", 3, 3, false, 2, "resolved", null],
      ["suggestion", "Кешкі уақытта тағы бір ағылшын тобы ашылса", "Күндізгі сабаққа мектебімнің кестесімен үлгеру қиын. Сағат 19:00-ден кейін қосымша топ ашу мүмкіндігін қарастырсаңыздар жақсы болар еді.", 3, 3, true, 2, "in_progress", null],
      ["opinion", "Информатикадағы практикалық мысалдар пайдалы", "Кодты бірге талдап шығатынымыз ұнайды. Дайын шешімді ғана көрмей, қатенің неден шыққанын түсінеміз. Осындай практикалық сабақтар көбірек болса екен.", 4, 4, false, 3, null, null],
    ];
    for (let i = 0; i < posts.length; i++) {
      const [type, title, body, course, teacher, anonymous, owner, status, outcome] =
        posts[i];
      const createdAt = hoursAgo((i + 1) * 6);
      await tx.insert("feedback", {
        id: demoId(1000 + i),
        number: 1001 + i,
        type,
        title,
        body,
        course_id: course === null ? null : demoId(100 + course),
        teacher_id: teacher === null ? null : demoId(200 + teacher),
        custom_target: null,
        anonymous,
        author_name: anonymous ? null : people[(owner as number) - 1][1],
        status,
        outcome,
        confirmed: false,
        hidden: false,
        hidden_reason: null,
        deleted: false,
        resolved_at: status === "resolved" ? hoursAgo(4) : null,
        created_at: createdAt,
        updated_at: createdAt,
      });
      await tx.insert("feedback_access", {
        feedback_id: demoId(1000 + i),
        profile_id: demoId(owner as number),
        recovery_email: null,
        code_hash: null,
      });
      if (status)
        await tx.insert("status_history", {
          id: demoId(2000 + i),
          feedback_id: demoId(1000 + i),
          status,
          outcome,
          created_at: createdAt,
        });
      for (let n = 1; n <= Math.min(3, Math.max(1, 4 - (i % 4))); n++)
        await tx.insert("supports", {
          profile_id: demoId(n),
          feedback_id: demoId(1000 + i),
        });
    }
    await tx.insert("official_replies", {
      id: demoId(3000),
      feedback_id: demoId(1002),
      profile_id: demoId(5),
      body: "Хабарлағаныңызға рақмет! Жазбаны тексеріп жатырмыз. Дыбысы түзетілген нұсқаны осы аптада қосамыз.",
      created_at: hoursAgo(10),
    });
    await tx.insert("official_replies", {
      id: demoId(3001),
      feedback_id: demoId(1006),
      profile_id: demoId(5),
      body: "Жаңа сілтеме топқа жіберілді. Қолжетімділікті қайта тексеріп көріңіз. Мәселе жалғасса, «Шешілмеді» деп белгілей аласыз.",
      created_at: hoursAgo(8),
    });
    await tx.insert("comments", {
      id: demoId(4000),
      feedback_id: demoId(1000),
      profile_id: demoId(2),
      parent_id: null,
      body: "Мен де қолдаймын! Әсіресе аптаның соңында қайталап шығуға жақсы мүмкіндік болар еді.",
      deleted: false,
      created_at: hoursAgo(12),
      updated_at: hoursAgo(12),
    });
    await tx.insert("comments", {
      id: demoId(4001),
      feedback_id: demoId(1001),
      profile_id: demoId(3),
      parent_id: null,
      body: "Толық келісемін. Мысалдардың өмірмен байланысты болғаны есте жақсы сақталады.",
      deleted: false,
      created_at: hoursAgo(9),
      updated_at: hoursAgo(9),
    });
    for (let t = 0; t < 5; t++)
      for (let u = 1; u <= 3; u++)
        await tx.insert("ratings", {
          profile_id: demoId(u),
          teacher_id: demoId(200 + t),
          stars: u === 2 && t % 2 === 0 ? 4 : 5,
          comment:
            u === 1
              ? "Тақырыпты түсінікті жеткізеді, сұрақтарға мұқият жауап береді."
              : "",
          updated_at: hoursAgo(20 - t - u),
        });
    await tx.insert("notifications", {
      id: demoId(5000),
      profile_id: demoId(2),
      feedback_id: demoId(1006),
      title: "Өтінішіңізге ресми жауап берілді",
      read_at: null,
      created_at: hoursAgo(8),
    });
  });
  await ensureDemoLogins(repo);
}
