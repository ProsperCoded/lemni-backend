ALTER TABLE `merchants` ADD `username` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_username_unique` ON `merchants` (`username`);