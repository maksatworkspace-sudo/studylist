import type { Database } from "./db";
import { passwordHash, token } from "./security";

export const demoId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function seed(db: Database) {
  if ((await db.query("SELECT id FROM profiles LIMIT 1")).length) return;
  await db.transaction(async (tx) => {
    const people = [
      [1, "Аружан Әлім", "user"],
      [2, "Айша Нұрлан", "user"],
      [3, "Ерасыл Омар", "user"],
      [4, "Дана Әлім", "teacher"],
      [5, "Әлия Серік", "admin"],
      [6, "Аян Қуаныш", "leadership"],
    ];
    for (const [n, name, role] of people) {
      await tx.query(
        "INSERT INTO profiles(id,name,email,phone,role,verified) VALUES($1,$2,$3,$4,$5,true)",
        [
          demoId(n as number),
          name,
          `demo${n}@maxball.example`,
          "+7 700 000 00 00",
          role,
        ],
      );
      await tx.query(
        "INSERT INTO private.local_credentials(profile_id,password_hash) VALUES($1,$2)",
        [demoId(n as number), passwordHash(token())],
      );
    }
    const courses = [
      "Математикалық сауаттылық",
      "Математика",
      "Қазақстан тарихы",
      "Ағылшын тілі",
      "Информатика",
    ];
    for (let i = 0; i < courses.length; i++)
      await tx.query("INSERT INTO courses(id,name) VALUES($1,$2)", [
        demoId(100 + i),
        courses[i],
      ]);
    const teachers = [
      ["Дана Әлім", "Математикалық сауаттылық", "blue"],
      ["Аян Серік", "Математика", "mint"],
      ["Нұржан Омар", "Қазақстан тарихы", "amber"],
      ["Аружан Ермек", "Ағылшын тілі", "rose"],
      ["Әлихан Болат", "Информатика", "violet"],
    ];
    for (let i = 0; i < teachers.length; i++)
      await tx.query(
        "INSERT INTO teachers(id,profile_id,name,subject,color) VALUES($1,$2,$3,$4,$5)",
        [demoId(200 + i), i === 0 ? demoId(4) : null, ...teachers[i]],
      );
    const posts = [
      [
        "suggestion",
        "Аптасына бір рет ашық сұрақ-жауап кездесуін өткізсек",
        "Сабақтан кейін кейбір сұрақтар қалып қояды. Әр жұмада барлық оқушы қатыса алатын қысқа сұрақ-жауап кездесуін өткізуді ұсынамын. Өзімізге қиын тақырыптарды алдын ала жіберсек, кездесу де пайдалырақ болар еді.",
        0,
        0,
        false,
        1,
        "in_progress",
        null,
      ],
      [
        "opinion",
        "Математиканы түсіну әлдеқайда жеңіл болды",
        "Дана апай күрделі есепті қарапайым мысалмен түсіндіреді. Соңғы екі аптада пробныйдағы нәтижем өсті. Әсіресе сабақтан кейінгі қысқа түсіндірмелер қатты көмектесті. Рақмет!",
        0,
        0,
        false,
        2,
        null,
        null,
      ],
      [
        "issue",
        "Сабақ жазбасының дыбысы кейде естілмейді",
        "Кешегі математика сабағының жазбасында 24-минуттан кейін дыбыс өте бәсеңдеп қалады. Бірнеше құрылғыдан тексеріп көрдім. Жазбаны қайта жүктеуге мүмкіндік бар ма?",
        1,
        1,
        true,
        3,
        "reviewing",
        null,
      ],
      [
        "suggestion",
        "Тақырыптық конспектілерді PDF форматында қоссақ",
        "Тарихтағы даталарды қайталау үшін әр тақырыпқа бір беттік қысқа конспект болса өте ыңғайлы. Сабақ видеосын көргеннен кейін бекітуге жақсы көмектесер еді.",
        2,
        2,
        false,
        3,
        "reviewed",
        "implemented",
      ],
      [
        "issue",
        "Телефоннан тапсырма файлын аша алмадым",
        "Информатика курсындағы бүгінгі тапсырма файлы телефонда ашылмай тұр. Браузерді жаңартып та көрдім. Файлға қайта қолжетімділік беруді сұраймын.",
        4,
        4,
        true,
        1,
        "new",
        null,
      ],
      [
        "opinion",
        "Орталықтағы қолдау ерекше ұнайды",
        "Топтағы атмосфера өте жылы. Қандай сұрақ болса да жауап аламын, ешкім сұрағыңа күліп қарамайды. Оқу процесін осылай ұйымдастырған командаға алғыс айтқым келеді.",
        null,
        null,
        false,
        1,
        null,
        null,
      ],
      [
        "issue",
        "Қосымша сабақтың сілтемесі жаңартылды",
        "Сенбі күнгі қосымша сабақтың сілтемесі ескі болып қалған еді. Әкімшілік жаңа сілтемені жіберді, қазір бәрі ашылып тұр. Жедел жауап бергендеріңізге рақмет.",
        3,
        3,
        false,
        2,
        "resolved",
        null,
      ],
      [
        "suggestion",
        "Кешкі уақытта тағы бір ағылшын тобы ашылса",
        "Күндізгі сабаққа мектебімнің кестесімен үлгеру қиын. Сағат 19:00-ден кейін қосымша топ ашу мүмкіндігін қарастырсаңыздар жақсы болар еді.",
        3,
        3,
        true,
        2,
        "in_progress",
        null,
      ],
      [
        "opinion",
        "Информатикадағы практикалық мысалдар пайдалы",
        "Кодты бірге талдап шығатынымыз ұнайды. Дайын шешімді ғана көрмей, қатенің неден шыққанын түсінеміз. Осындай практикалық сабақтар көбірек болса екен.",
        4,
        4,
        false,
        3,
        null,
        null,
      ],
    ];
    for (let i = 0; i < posts.length; i++) {
      const [
        type,
        title,
        body,
        course,
        teacher,
        anonymous,
        owner,
        status,
        outcome,
      ] = posts[i];
      await tx.query(
        `INSERT INTO feedback(id,type,title,body,course_id,teacher_id,anonymous,author_name,status,outcome,created_at,resolved_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()-$11*interval '1 hour',CASE WHEN $9='resolved' THEN now()-interval '4 hour' ELSE NULL END)`,
        [
          demoId(1000 + i),
          type,
          title,
          body,
          course === null ? null : demoId(100 + (course as number)),
          teacher === null ? null : demoId(200 + (teacher as number)),
          anonymous,
          anonymous ? null : people[(owner as number) - 1][1],
          status,
          outcome,
          (i + 1) * 6,
        ],
      );
      await tx.query(
        "INSERT INTO private.feedback_access(feedback_id,profile_id) VALUES($1,$2)",
        [demoId(1000 + i), demoId(owner as number)],
      );
      if (status)
        await tx.query(
          "INSERT INTO status_history(id,feedback_id,status,outcome) VALUES($1,$2,$3,$4)",
          [demoId(2000 + i), demoId(1000 + i), status, outcome],
        );
      for (let n = 1; n <= Math.min(3, Math.max(1, 4 - (i % 4))); n++)
        await tx.query(
          "INSERT INTO supports(profile_id,feedback_id) VALUES($1,$2)",
          [demoId(n), demoId(1000 + i)],
        );
    }
    await tx.query(
      "INSERT INTO official_replies(id,feedback_id,profile_id,body) VALUES($1,$2,$3,$4)",
      [
        demoId(3000),
        demoId(1002),
        demoId(5),
        "Хабарлағаныңызға рақмет! Жазбаны тексеріп жатырмыз. Дыбысы түзетілген нұсқаны осы аптада қосамыз.",
      ],
    );
    await tx.query(
      "INSERT INTO official_replies(id,feedback_id,profile_id,body) VALUES($1,$2,$3,$4)",
      [
        demoId(3001),
        demoId(1006),
        demoId(5),
        "Жаңа сілтеме топқа жіберілді. Қолжетімділікті қайта тексеріп көріңіз. Мәселе жалғасса, «Шешілмеді» деп белгілей аласыз.",
      ],
    );
    await tx.query(
      "INSERT INTO comments(id,feedback_id,profile_id,body) VALUES($1,$2,$3,$4)",
      [
        demoId(4000),
        demoId(1000),
        demoId(2),
        "Мен де қолдаймын! Әсіресе аптаның соңында қайталап шығуға жақсы мүмкіндік болар еді.",
      ],
    );
    await tx.query(
      "INSERT INTO comments(id,feedback_id,profile_id,body) VALUES($1,$2,$3,$4)",
      [
        demoId(4001),
        demoId(1001),
        demoId(3),
        "Толық келісемін. Мысалдардың өмірмен байланысты болғаны есте жақсы сақталады.",
      ],
    );
    for (let t = 0; t < 5; t++)
      for (let u = 1; u <= 3; u++)
        await tx.query(
          "INSERT INTO ratings(profile_id,teacher_id,stars,comment) VALUES($1,$2,$3,$4)",
          [
            demoId(u),
            demoId(200 + t),
            u === 2 && t % 2 === 0 ? 4 : 5,
            u === 1
              ? "Тақырыпты түсінікті жеткізеді, сұрақтарға мұқият жауап береді."
              : "",
          ],
        );
    await tx.query(
      "INSERT INTO private.notifications(id,profile_id,feedback_id,title) VALUES($1,$2,$3,$4)",
      [
        demoId(5000),
        demoId(2),
        demoId(1006),
        "Өтінішіңізге ресми жауап берілді",
      ],
    );
  });
}
