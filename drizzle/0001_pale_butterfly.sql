CREATE TABLE `couples` (
	`id` varchar(64) NOT NULL,
	`ownerTelegramId` varchar(32) NOT NULL,
	`partnerTelegramId` varchar(32),
	`inviteCode` varchar(32),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `couples_id` PRIMARY KEY(`id`),
	CONSTRAINT `couples_ownerTelegramId_unique` UNIQUE(`ownerTelegramId`),
	CONSTRAINT `couples_partnerTelegramId_unique` UNIQUE(`partnerTelegramId`),
	CONSTRAINT `couples_inviteCode_unique` UNIQUE(`inviteCode`)
);
--> statement-breakpoint
CREATE TABLE `synced_household_tasks` (
	`id` varchar(160) NOT NULL,
	`coupleId` varchar(64) NOT NULL,
	`authorTelegramId` varchar(32) NOT NULL,
	`payload` text NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`deleted` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `synced_household_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `synced_wishes` (
	`id` varchar(160) NOT NULL,
	`coupleId` varchar(64) NOT NULL,
	`authorTelegramId` varchar(32) NOT NULL,
	`scope` enum('personal','together') NOT NULL,
	`payload` text NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`deleted` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `synced_wishes_id` PRIMARY KEY(`id`)
);
