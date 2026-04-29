const supabase = require('../config/supabaseClient');
const axios = require('axios');

async function getAll(req, res) {
	try {
		const userId = req.user?.id;
		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		const { type } = req.query; // 'ai' or 'event' or undefined for all

		let query = supabase
			.from('reminders')
			.select('id, person, remind_date, pref, description, reminder_type, is_recurring, original_date, recurrence_type, created_at, updated_at')
			.eq('user_id', userId);

		// Filter by type if provided
		if (type && (type === 'ai' || type === 'event')) {
			query = query.eq('reminder_type', type);
		}

		const { data, error } = await query.order('remind_date', { ascending: true });

		if (error) {
			console.error('Error fetching reminders:', error);
			return res.status(500).json({ message: 'Failed to fetch reminders' });
		}

		// For recurring reminders, calculate the next occurrence date
		const processedData = (data || []).map(reminder => {
			if (reminder.is_recurring && reminder.original_date && reminder.recurrence_type === 'yearly') {
				const today = new Date();
				today.setHours(0, 0, 0, 0);
				const originalDate = new Date(reminder.original_date);
				const currentYear = today.getFullYear();
				
				// Calculate next occurrence
				let nextDate = new Date(currentYear, originalDate.getMonth(), originalDate.getDate());
				if (nextDate < today) {
					// If this year's date has passed, use next year
					nextDate = new Date(currentYear + 1, originalDate.getMonth(), originalDate.getDate());
				}
				
				return {
					...reminder,
					remind_date: nextDate.toISOString().split('T')[0], // Update to next occurrence
					original_date: reminder.original_date
				};
			}
			return reminder;
		});

		return res.status(200).json(processedData);
	} catch (err) {
		console.error('getAll reminders error:', err);
		return res.status(500).json({ message: 'Server error' });
	}
}

// Generate AI description for reminder
async function generateReminderDescription(person, remind_date, plan = '') {
	try {
		const OPENROUTER_KEY = process.env.CHATKEY;
		if (!OPENROUTER_KEY) {
			console.warn('OpenRouter API key not set, skipping description generation');
			return null;
		}

		const prompt = `Create a brief, warm, and personalized description (2-3 sentences maximum) for a reminder about "${person}" on ${remind_date}. ${plan ? `The reminder is related to: ${plan}` : ''} Make it thoughtful and meaningful.`;

		const response = await axios.post(
			"https://openrouter.ai/api/v1/chat/completions",
			{
				model: "tngtech/deepseek-r1t2-chimera:free",
				messages: [
					{ role: "system", content: "You are a helpful assistant that creates warm, personalized reminder descriptions." },
					{ role: "user", content: prompt }
				],
			},
			{
				headers: {
					Authorization: `Bearer ${OPENROUTER_KEY}`,
					"Content-Type": "application/json",
				},
			}
		);

		return response.data.choices?.[0]?.message?.content?.trim() || null;
	} catch (err) {
		console.error('Error generating reminder description:', err.response?.data || err.message || err);
		return null;
	}
}

async function create(req, res) {
	try {
		const userId = req.user?.id;
		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		const { 
			person, 
			remind_date, 
			pref = 'app',
			reminder_type = 'ai',
			is_recurring = false,
			recurrence_type = null
		} = req.body;

		if (!person || !remind_date) {
			return res.status(400).json({ message: 'Person and remind_date are required' });
		}

		// Validate reminder_type
		if (reminder_type && !['ai', 'event'].includes(reminder_type)) {
			return res.status(400).json({ message: 'Invalid reminder_type. Must be "ai" or "event"' });
		}

		// For recurring reminders, validate recurrence_type
		if (is_recurring && !recurrence_type) {
			return res.status(400).json({ message: 'recurrence_type is required for recurring reminders' });
		}

		if (is_recurring && !['yearly', 'monthly', 'weekly'].includes(recurrence_type)) {
			return res.status(400).json({ message: 'Invalid recurrence_type. Must be "yearly", "monthly", or "weekly"' });
		}

		// Prepare insert data
		const insertData = {
			user_id: userId,
			person: person,
			remind_date: remind_date,
			pref: pref,
			reminder_type: reminder_type,
			is_recurring: is_recurring
		};

		// For recurring reminders, store original_date
		if (is_recurring) {
			insertData.original_date = remind_date;
			insertData.recurrence_type = recurrence_type;
		}

		const { data, error } = await supabase
			.from('reminders')
			.insert([insertData])
			.select('id, person, remind_date, pref, description, reminder_type, is_recurring, original_date, recurrence_type, created_at')
			.single();

		if (error) {
			console.error('Error creating reminder:', error);
			return res.status(500).json({ message: 'Failed to create reminder' });
		}

		// Generate AI description only for AI reminders
		if (reminder_type === 'ai') {
			let description = null;
			try {
				description = await generateReminderDescription(person, remind_date);
				if (description) {
					await supabase
						.from('reminders')
						.update({ description })
						.eq('id', data.id);
					// Update the returned data to include description
					data.description = description;
				}
			} catch (descError) {
				console.error('Error generating or saving description:', descError);
				// Don't fail the reminder creation if description generation fails
			}
		}

		// Schedule reminder if needed (only for non-recurring or first occurrence)
		if (!is_recurring) {
			try {
				const scheduleDSReminder = require('./scheduleDSReminder');
				await scheduleDSReminder({
					user_id: userId,
					title: person,
					reminder_time: new Date(remind_date).toISOString()
				});
			} catch (scheduleError) {
				console.error('Error scheduling reminder:', scheduleError);
				// Don't fail if scheduling fails
			}
		}

		return res.status(201).json(data);
	} catch (err) {
		console.error('create reminder error:', err);
		return res.status(500).json({ message: 'Server error' });
	}
}

async function update(req, res) {
	try {
		const userId = req.user?.id;
		const reminderId = req.params.id;
		const { person, remind_date, pref = 'app' } = req.body;

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		if (!reminderId) {
			return res.status(400).json({ message: 'Reminder ID is required' });
		}

		if (!person || !remind_date) {
			return res.status(400).json({ message: 'Person and remind_date are required' });
		}

		// Verify the reminder belongs to the user
		const { data: reminder, error: checkError } = await supabase
			.from('reminders')
			.select('id')
			.eq('id', reminderId)
			.eq('user_id', userId)
			.single();

		if (checkError || !reminder) {
			return res.status(404).json({ message: 'Reminder not found' });
		}

		const updateData = {
			person: person,
			remind_date: remind_date,
			pref: pref
		};

		// If updating a recurring reminder's date, also update original_date
		const { data: existingReminder } = await supabase
			.from('reminders')
			.select('is_recurring, original_date')
			.eq('id', reminderId)
			.single();

		if (existingReminder?.is_recurring) {
			updateData.original_date = remind_date;
		}

		const { data, error } = await supabase
			.from('reminders')
			.update(updateData)
			.eq('id', reminderId)
			.eq('user_id', userId)
			.select('id, person, remind_date, pref, description, reminder_type, is_recurring, original_date, recurrence_type, created_at, updated_at')
			.single();

		if (error) {
			console.error('Error updating reminder:', error);
			return res.status(500).json({ message: 'Failed to update reminder' });
		}

		return res.status(200).json(data);
	} catch (err) {
		console.error('update reminder error:', err);
		return res.status(500).json({ message: 'Server error' });
	}
}

async function remove(req, res) {
	try {
		const userId = req.user?.id;
		const reminderId = req.params.id;

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		if (!reminderId) {
			return res.status(400).json({ message: 'Reminder ID is required' });
		}

		// Verify the reminder belongs to the user
		const { data: reminder, error: checkError } = await supabase
			.from('reminders')
			.select('id')
			.eq('id', reminderId)
			.eq('user_id', userId)
			.single();

		if (checkError || !reminder) {
			return res.status(404).json({ message: 'Reminder not found' });
		}

		const { error } = await supabase
			.from('reminders')
			.delete()
			.eq('id', reminderId)
			.eq('user_id', userId);

		if (error) {
			console.error('Error deleting reminder:', error);
			return res.status(500).json({ message: 'Failed to delete reminder' });
		}

		return res.status(204).send();
	} catch (err) {
		console.error('remove reminder error:', err);
		return res.status(500).json({ message: 'Server error' });
	}
}

module.exports = { getAll, create, update, remove };
