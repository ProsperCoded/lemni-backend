ALTER TABLE `merchants` ADD `hashed_password` text;--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_email_unique` ON `merchants` (`email`);