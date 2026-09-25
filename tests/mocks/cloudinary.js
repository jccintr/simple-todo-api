import { vi } from 'vitest';

export default {
  uploader: {
    upload_stream: vi.fn((options, callback) => {
      return {
        end: () => {
          callback(null, {
            secure_url:
              'https://res.cloudinary.com/demo/image/upload/v1/delivroo/riders/rider_test.jpg',
            public_id: 'delivroo/riders/rider_test',
          });
        },
      };
    }),
  },
};