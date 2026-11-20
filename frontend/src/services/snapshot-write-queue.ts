export function createSnapshotWriteQueue(
    write: (snapshot: string) => Promise<void>
) {
    let tail: Promise<void> = Promise.resolve();
    let lastWritten: string | null = null;

    return {
        save(snapshot: string): Promise<void> {
            const job = tail.then(async () => {
                if (snapshot === lastWritten) return;

                await write(snapshot);
                lastWritten = snapshot;
            });

            // Не позволяем одной неудачной записи
            // заблокировать все следующие.
            tail = job.catch(() => {});

            return job;
        },

        flush(): Promise<void> {
            return tail;
        },

        reset(): void {
            lastWritten = null;
        },
    };
}
